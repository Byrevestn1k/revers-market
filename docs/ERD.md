# ER diagram

Логічна ER-діаграма моделі PostgreSQL + PostGIS. Геометричні поля позначені як `geography`.

```mermaid
erDiagram
    USERS ||--|| PROFILES : has
    USERS ||--o{ ADDRESSES : owns
    USERS ||--o{ PRODUCTS : sells
    USERS ||--o{ BUY_REQUESTS : creates
    USERS ||--o{ OFFERS : submits
    USERS ||--o{ ORDERS : buys
    USERS ||--o{ ORDERS : fulfills
    USERS ||--o{ MESSAGES : sends
    USERS ||--o{ REVIEWS : writes
    USERS ||--o{ REVIEWS : receives
    USERS ||--o{ NOTIFICATIONS : receives
    USERS ||--o{ REPORTS : reports
    USERS ||--o{ AUDIT_LOGS : acts

    CATEGORIES ||--o{ CATEGORIES : contains
    CATEGORIES ||--o{ PRODUCTS : classifies
    CATEGORIES ||--o{ BUY_REQUESTS : classifies

    PRODUCTS ||--o{ PRODUCT_IMAGES : has
    ADDRESSES ||--o{ BUY_REQUESTS : destination
    ADDRESSES ||--o{ ORDERS : delivery

    BUY_REQUESTS ||--o{ OFFERS : receives
    PRODUCTS o|--o{ OFFERS : references
    BUY_REQUESTS ||--o{ ORDERS : fulfilled_by
    OFFERS o|--o{ ORDER_ITEMS : accepted_as
    PRODUCTS o|--o{ ORDER_ITEMS : snapshot_source
    ORDERS ||--|{ ORDER_ITEMS : contains

    BUY_REQUESTS o|--o{ CONVERSATIONS : discusses
    ORDERS o|--o{ CONVERSATIONS : discusses
    CONVERSATIONS ||--o{ PARTICIPANTS : includes
    USERS ||--o{ PARTICIPANTS : joins
    CONVERSATIONS ||--o{ MESSAGES : contains

    ORDERS ||--o{ REVIEWS : receives
    USERS ||--o{ REPORTS : targets

    USERS {
        uuid id PK
        citext email UK
        text phone
        text status
        timestamptz created_at
    }
    PROFILES {
        uuid user_id PK, FK
        text display_name
        boolean seller_enabled
    }
    ADDRESSES {
        uuid id PK
        uuid user_id FK
        char country_code
        text city_code
        text city_name
        geography location
        text visibility
    }
    CATEGORIES {
        uuid id PK
        uuid parent_id FK
        text code UK
        text name
    }
    PRODUCTS {
        uuid id PK
        uuid seller_id FK
        uuid category_id FK
        text title
        numeric base_unit_price
        text status
    }
    PRODUCT_IMAGES {
        uuid id PK
        uuid product_id FK
        text storage_key
        integer sort_order
    }
    BUY_REQUESTS {
        uuid id PK
        uuid buyer_id FK
        uuid category_id FK
        numeric requested_quantity
        numeric fulfilled_quantity
        geography search_area
        text status
    }
    OFFERS {
        uuid id PK
        uuid buy_request_id FK
        uuid seller_id FK
        uuid product_id FK
        numeric offered_quantity
        numeric accepted_quantity
        numeric unit_price
        jsonb terms
        text status
    }
    ORDERS {
        uuid id PK
        uuid buy_request_id FK
        uuid buyer_id FK
        uuid seller_id FK
        uuid delivery_address_id FK
        numeric subtotal
        text status
    }
    ORDER_ITEMS {
        uuid id PK
        uuid order_id FK
        uuid offer_id FK
        uuid product_id FK
        numeric quantity
        numeric unit_price
        text product_title_snapshot
        jsonb offer_terms_snapshot
    }
    CONVERSATIONS {
        uuid id PK
        uuid buy_request_id FK
        uuid order_id FK
        timestamptz created_at
    }
    PARTICIPANTS {
        uuid conversation_id PK, FK
        uuid user_id PK, FK
        timestamptz joined_at
    }
    MESSAGES {
        uuid id PK
        uuid conversation_id FK
        uuid sender_id FK
        text message_type
        text body
    }
    REVIEWS {
        uuid id PK
        uuid order_id FK
        uuid author_id FK
        uuid subject_id FK
        smallint rating
    }
    NOTIFICATIONS {
        uuid id PK
        uuid user_id FK
        text type
        jsonb payload
        timestamptz read_at
    }
    REPORTS {
        uuid id PK
        uuid reporter_id FK
        uuid reported_user_id FK
        text entity_type
        uuid entity_id
        text status
    }
    AUDIT_LOGS {
        uuid id PK
        uuid actor_id FK
        text action
        text entity_type
        uuid entity_id
        jsonb before_data
        jsonb after_data
    }
```

`offers.accepted_quantity` і зв'язок `buy_requests -> orders` моделюють часткове виконання одним або кількома продавцями. `order_items` містить snapshot істотних умов прийнятого offer.
