CREATE TABLE IF NOT EXISTS site_control_assets (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('background', 'social')),
  mime_type TEXT NOT NULL CHECK (mime_type IN ('image/png', 'image/jpeg', 'image/webp')),
  data BYTEA NOT NULL CHECK (octet_length(data) BETWEEN 1 AND 2097152),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS site_control_settings (
  id SMALLINT PRIMARY KEY CHECK (id = 1),
  mode TEXT NOT NULL CHECK (mode IN ('open', 'coming_soon', 'maintenance')),
  heading TEXT NOT NULL CHECK (length(heading) BETWEEN 1 AND 120),
  subtitle TEXT NOT NULL CHECK (length(subtitle) BETWEEN 1 AND 180),
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 1200),
  status_label TEXT NOT NULL CHECK (length(status_label) BETWEEN 1 AND 60),
  maintenance_heading TEXT NOT NULL CHECK (length(maintenance_heading) BETWEEN 1 AND 120),
  maintenance_subtitle TEXT NOT NULL CHECK (length(maintenance_subtitle) BETWEEN 1 AND 180),
  maintenance_description TEXT NOT NULL CHECK (length(maintenance_description) BETWEEN 1 AND 1200),
  maintenance_status_label TEXT NOT NULL CHECK (length(maintenance_status_label) BETWEEN 1 AND 60),
  launch_at TIMESTAMPTZ,
  countdown_enabled BOOLEAN NOT NULL DEFAULT false,
  about_button_label TEXT NOT NULL CHECK (length(about_button_label) BETWEEN 1 AND 60),
  about_title TEXT NOT NULL CHECK (length(about_title) BETWEEN 1 AND 120),
  about_body TEXT NOT NULL CHECK (length(about_body) BETWEEN 1 AND 4000),
  animation_enabled BOOLEAN NOT NULL DEFAULT true,
  background_asset_id UUID,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO site_control_settings (
  id, mode, heading, subtitle, description, status_label, maintenance_heading, maintenance_subtitle, maintenance_description, maintenance_status_label, countdown_enabled,
  about_button_label, about_title, about_body, animation_enabled
) VALUES (
  1, 'open', 'CQRTV скоро откроется', 'Новая платформа для игроков Counter-Strike 2',
  'Мы готовим пространство для игроков и команд: подбор матчей, турниры, статистика и развитие esports-сцены.',
  'ПЛАТФОРМА ГОТОВИТСЯ', 'CQRTV на техобслуживании', 'Мы настраиваем платформу и скоро вернёмся.', 'Проводятся технические работы', 'ТЕХНИЧЕСКИЕ РАБОТЫ', false, 'Что такое CQRTV?',
  'Играй. Объединяйся. Развивайся.',
  'CQRTV — будущая платформа Counter-Strike 2 для игроков и команд. Здесь можно будет находить партнёров, собирать составы, играть матчи, участвовать в турнирах, следить за статистикой и вместе развивать esports-сцену.',
  true
) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS site_control_social_links (
  id UUID PRIMARY KEY,
  label TEXT NOT NULL CHECK (length(label) BETWEEN 1 AND 40),
  url TEXT NOT NULL CHECK (length(url) BETWEEN 1 AND 2048),
  icon_key TEXT NOT NULL CHECK (icon_key IN ('chat', 'play', 'mail', 'home', 'users', 'gamepad', 'ranking')),
  icon_asset_id UUID,
  enabled BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order BETWEEN -1000 AND 1000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS site_control_social_sort_idx ON site_control_social_links (enabled, sort_order, id);
