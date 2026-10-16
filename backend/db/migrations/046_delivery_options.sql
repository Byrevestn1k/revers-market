-- NULL means that the older record has not supplied enough structured terms.
-- Do not infer postal reach or radii from the former single delivery labels.
ALTER TABLE products ADD COLUMN delivery_options jsonb;
ALTER TABLE buy_requests ADD COLUMN delivery_options jsonb;
ALTER TABLE offers ADD COLUMN delivery_options jsonb;
ALTER TABLE demand_subscriptions ADD COLUMN delivery_options jsonb;

ALTER TABLE products ADD CONSTRAINT products_delivery_options_array CHECK (delivery_options IS NULL OR jsonb_typeof(delivery_options) = 'array');
ALTER TABLE buy_requests ADD CONSTRAINT buy_requests_delivery_options_array CHECK (delivery_options IS NULL OR jsonb_typeof(delivery_options) = 'array');
ALTER TABLE offers ADD CONSTRAINT offers_delivery_options_array CHECK (delivery_options IS NULL OR jsonb_typeof(delivery_options) = 'array');
ALTER TABLE demand_subscriptions ADD CONSTRAINT subscriptions_delivery_options_array CHECK (delivery_options IS NULL OR jsonb_typeof(delivery_options) = 'array');

ALTER TABLE products DROP CONSTRAINT products_delivery_mode;
ALTER TABLE products ADD CONSTRAINT products_delivery_mode CHECK (delivery_mode IN ('pickup', 'seller_delivery', 'carrier', 'flexible'));
