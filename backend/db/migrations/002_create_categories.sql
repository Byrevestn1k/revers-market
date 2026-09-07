CREATE TABLE categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id uuid REFERENCES categories(id),
    code text NOT NULL UNIQUE,
    name text NOT NULL,
    path text,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX categories_parent_id_idx ON categories (parent_id);
CREATE INDEX categories_active_idx ON categories (is_active) WHERE is_active;
