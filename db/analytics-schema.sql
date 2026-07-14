-- Analytics schema pentru on-site-dev.
-- Ruleaza pe instanta Postgres DEDICATA pentru analytics (separata de cea operationala).
-- Sursa de adevar: `events` (append-only). `pallets` = registrul de payroll.
-- Vezi planul: C:\Users\titam\.claude\plans\fa-un-plan-pentru-sharded-lovelace.md

-- ─────────────────────────────────────────────────────────────────────────────
-- Tabele
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS events (
    event_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_uuid    uuid        NOT NULL,      -- generat de sursa; cheie de dedup
    event_type    text        NOT NULL,      -- vezi catalogul din plan
    schema_ver    smallint    NOT NULL DEFAULT 1,

    -- actor / sesiune
    operator_code text,                      -- codul de acces (de preferat hash-uit)
    operator_name text,                      -- loggedInUser (display)
    session_id    uuid,                      -- sesiune de login pe client

    -- dimensiuni de business (coloane "calde", scoase din payload)
    command_id    text,
    manifest_sku  text,
    pallet_type   text,                      -- 'yellow' | 'grey' | 'red'
    product_sku   text,                      -- NULL pentru produse necunoscute
    asin          text,
    condition     text,                      -- new | very-good | good | broken
    quantity      integer,                   -- delta cu semn / count

    -- provenienta / integritate
    source        text        NOT NULL DEFAULT 'client', -- 'client' | 'server'
    is_money      boolean     NOT NULL DEFAULT false,
    client_ts     timestamptz,               -- din browser (doar diferente intra-sesiune)
    server_ts     timestamptz NOT NULL DEFAULT now(),    -- autoritar
    clock_skew_ms integer,                   -- server_ts - client_ts la ingest

    payload       jsonb       NOT NULL DEFAULT '{}'::jsonb,

    CONSTRAINT events_dedup UNIQUE (event_uuid)
);

CREATE INDEX IF NOT EXISTS idx_events_operator_time ON events (operator_code, server_ts);
CREATE INDEX IF NOT EXISTS idx_events_session_time  ON events (session_id, client_ts);
CREATE INDEX IF NOT EXISTS idx_events_pallet        ON events (manifest_sku, command_id);
CREATE INDEX IF NOT EXISTS idx_events_type_time     ON events (event_type, server_ts);
CREATE INDEX IF NOT EXISTS idx_events_product       ON events (command_id, product_sku, client_ts);
CREATE INDEX IF NOT EXISTS idx_events_money         ON events (server_ts) WHERE is_money;

-- Registrul de payroll. PK compus => finalizarea repetata face UPDATE, niciodata
-- un al doilea rand => imposibil de dublu-platit structural.
CREATE TABLE IF NOT EXISTS pallets (
    command_id         text NOT NULL,
    manifest_sku       text NOT NULL,
    pallet_type        text NOT NULL,        -- yellow | grey | red
    status             text NOT NULL DEFAULT 'open', -- open | completed | paid
    assigned_operator  text,                 -- operator_code creditat (finalizatorul)
    expected_total     integer,
    found_total        integer,
    product_count      integer,
    completed_at       timestamptz,
    completed_event_id bigint REFERENCES events(event_id),
    paid_at            timestamptz,
    payroll_batch_id   text,
    updated_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (command_id, manifest_sku)
);
CREATE INDEX IF NOT EXISTS idx_pallets_payroll ON pallets (assigned_operator, status, completed_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- View-uri de analiza (bucketing in fusul local ca schimburile de noapte sa nu se rupa)
-- ─────────────────────────────────────────────────────────────────────────────

-- Payroll: paleti finalizati per operator per tip. Sursa = `pallets`, NU `events`.
CREATE OR REPLACE VIEW payroll_pallets AS
SELECT assigned_operator, pallet_type,
       COUNT(*) FILTER (WHERE status = 'completed') AS completed_unpaid,
       COUNT(*) FILTER (WHERE status = 'paid')      AS already_paid
FROM pallets
GROUP BY 1, 2;

-- Gap-uri intre evenimente in aceeasi sesiune (baza pt pauze si faze).
CREATE OR REPLACE VIEW event_gaps AS
SELECT event_id, session_id, operator_code, event_type, client_ts, server_ts,
       command_id, manifest_sku, product_sku, pallet_type,
       EXTRACT(EPOCH FROM client_ts - lag(client_ts) OVER w) AS gap_s
FROM events
WINDOW w AS (PARTITION BY session_id ORDER BY client_ts);

-- Timp activ per operator per zi = wall time - pauze (gap > 15 min).
CREATE OR REPLACE VIEW operator_active_time AS
SELECT operator_code,
       date_trunc('day', server_ts AT TIME ZONE 'Europe/Bucharest') AS day,
       EXTRACT(EPOCH FROM max(client_ts) - min(client_ts))
         - COALESCE(SUM(gap_s) FILTER (WHERE gap_s > 15 * 60), 0) AS active_s
FROM event_gaps
GROUP BY 1, 2;

-- Timp pe faze per produs (evaluare, introducere date).
CREATE OR REPLACE VIEW product_phase_timings AS
WITH steps AS (
  SELECT session_id, command_id, product_sku, event_type, client_ts,
         lead(client_ts) OVER (PARTITION BY session_id, command_id, product_sku
                               ORDER BY client_ts) AS next_ts
  FROM events
  WHERE product_sku IS NOT NULL
)
SELECT session_id, command_id, product_sku,
  MAX(next_ts - client_ts) FILTER (WHERE event_type = 'product_detail_opened') AS evaluate_s,
  MAX(next_ts - client_ts) FILTER (WHERE event_type = 'stock_modal_opened')    AS data_entry_s
FROM steps
GROUP BY 1, 2, 3;

-- Rata de succes a scanarii per operator per zi.
CREATE OR REPLACE VIEW scan_success AS
SELECT operator_code,
       date_trunc('day', server_ts AT TIME ZONE 'Europe/Bucharest') AS day,
       COUNT(*) FILTER (WHERE event_type = 'scan_matched') AS matched,
       COUNT(*) FILTER (WHERE event_type = 'scan_found_not_in_orders') AS found_not_in_orders,
       COUNT(*) FILTER (WHERE event_type = 'scan_failed')  AS failed,
       ROUND(100.0 * COUNT(*) FILTER (WHERE event_type = 'scan_matched')
             / NULLIF(COUNT(*) FILTER (WHERE event_type LIKE 'scan_%'), 0), 1) AS success_pct
FROM events
WHERE event_type LIKE 'scan_%'
GROUP BY 1, 2;

-- Palnia de identificare a produselor necunoscute.
CREATE OR REPLACE VIEW identification_funnel AS
SELECT operator_code,
       date_trunc('day', server_ts AT TIME ZONE 'Europe/Bucharest') AS day,
       COUNT(*) FILTER (WHERE event_type = 'search_opened')        AS searched,
       COUNT(*) FILTER (WHERE event_type = 'product_added_manual') AS added_manual,
       COUNT(*) FILTER (WHERE event_type = 'product_discarded')    AS discarded
FROM events
GROUP BY 1, 2;

-- Productivitate per operator per zi (materializat; REFRESH periodic).
CREATE MATERIALIZED VIEW IF NOT EXISTS operator_productivity AS
SELECT operator_code,
       date_trunc('day', server_ts AT TIME ZONE 'Europe/Bucharest') AS day,
       COUNT(*) FILTER (WHERE event_type = 'stock_updated') AS stock_actions,
       SUM(quantity) FILTER (WHERE event_type = 'stock_updated' AND quantity > 0) AS units_added,
       COUNT(*) FILTER (WHERE event_type = 'pallet_completed') AS pallets_done
FROM events
GROUP BY 1, 2;

-- Contribuitori per palet (pt o politica de split-pay multi-operator viitoare).
CREATE OR REPLACE VIEW pallet_contributors AS
SELECT command_id, manifest_sku,
       array_agg(DISTINCT operator_code) AS operators
FROM events
WHERE event_type IN ('stock_updated', 'scan_matched')
  AND manifest_sku IS NOT NULL
GROUP BY 1, 2;

-- Reconciliere: estimeaza pierderea de evenimente de context (calitatea datelor).
CREATE OR REPLACE VIEW money_without_context AS
SELECT e.event_id, e.product_sku, e.session_id
FROM events e
WHERE e.event_type = 'stock_updated'
  AND NOT EXISTS (
      SELECT 1 FROM events c
      WHERE c.session_id = e.session_id
        AND c.product_sku = e.product_sku
        AND c.event_type = 'stock_modal_opened'
        AND c.client_ts <= e.client_ts
  );
