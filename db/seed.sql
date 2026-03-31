-- Quorum D1 seed data — sample organizers + events
-- Apply with: wrangler d1 execute quorum-db --file db/seed.sql

-- ── Sample users ─────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO users (id, full_name, email, google_id) VALUES
  ('seed-user-marcus', 'Marcus Bell', 'marcus.bell.seed@example.com', 'seed_user_jazz_org'),
  ('seed-user-priya',  'Priya Nair',  'priya.nair.seed@example.com',  'seed_user_yoga_org'),
  ('seed-user-sofia',  'Sofia Reyes', 'sofia.reyes.seed@example.com', 'seed_user_film_org'),
  ('seed-user-james',  'James Okafor','james.okafor.seed@example.com','seed_user_hike_org');

-- ── Sample events ────────────────────────────────────────────────────────────

INSERT OR IGNORE INTO events (id, organizer_id, title, description, location, threshold, deadline, visibility, status, cost_tiers_json, price_quorum_cents, image_key) VALUES
  ('seed-evt-jazz',
   'seed-user-marcus',
   'Thursday Night Jazz — Live Sessions',
   'An intimate evening of live jazz in a brick-walled cellar bar. Featuring local quartet and guest soloists.',
   'Chicago, IL', 20,
   datetime('now', '+18 days'),
   'public', 'active',
   '[{"label":"General Admission","amount":1500},{"label":"VIP (front row + drink)","amount":3000}]',
   45000,
   'https://images.unsplash.com/photo-1511192336575-5a79af67a629?w=900&q=80'),

  ('seed-evt-yoga',
   'seed-user-priya',
   'Sunrise Yoga in the Park',
   'Start your Saturday with an outdoor vinyasa flow. All levels welcome — bring your own mat.',
   'Austin, TX', 12,
   datetime('now', '+10 days'),
   'public', 'active',
   NULL, NULL,
   'https://images.unsplash.com/photo-1506126613408-eca07ce68773?w=900&q=80'),

  ('seed-evt-film',
   'seed-user-sofia',
   'Hidden Gems Film Club: 1970s Italian Cinema',
   'Monthly screening series. Two back-to-back films from the 1970s Italian canon, intro by our host.',
   'Brooklyn, NY', 25,
   datetime('now', '+22 days'),
   'public', 'active',
   '[{"label":"Admission","amount":1200}]',
   30000,
   'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=900&q=80'),

  ('seed-evt-hike',
   'seed-user-james',
   'Sunrise Ridge Trail Hike',
   'A moderate 7-mile loop through the foothills with ~1,200 ft elevation gain. Stunning sunrise views.',
   'Denver, CO', 8,
   datetime('now', '+14 days'),
   'public', 'active',
   NULL, NULL,
   'https://images.unsplash.com/photo-1551632811-561732d1e306?w=900&q=80'),

  ('seed-evt-workshop',
   'seed-user-marcus',
   'Jazz Improvisation Workshop',
   'Hands-on afternoon workshop for intermediate musicians. Blues scales, chord substitution, trading fours.',
   'Chicago, IL', 6,
   datetime('now', '+30 days'),
   'public', 'active',
   '[{"label":"Student","amount":2000},{"label":"General","amount":3500},{"label":"Supporter","amount":5000}]',
   NULL,
   'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=900&q=80'),

  ('seed-evt-potluck',
   'seed-user-priya',
   'Community Potluck Dinner',
   'Neighbourhood potluck — bring a dish to share. Tables, chairs, plates, and drinks provided.',
   'Austin, TX', 15,
   datetime('now', '+8 days'),
   'public', 'active',
   NULL, NULL,
   'https://images.unsplash.com/photo-1555939594-58d7cb561ad1?w=900&q=80');

-- ── Time slots for each event ────────────────────────────────────────────────

INSERT OR IGNORE INTO time_slots (id, event_id, starts_at, ends_at) VALUES
  ('seed-slot-jazz-1', 'seed-evt-jazz', datetime('now', '+21 days', 'start of day', '+19 hours'), datetime('now', '+21 days', 'start of day', '+22 hours')),
  ('seed-slot-jazz-2', 'seed-evt-jazz', datetime('now', '+28 days', 'start of day', '+19 hours'), datetime('now', '+28 days', 'start of day', '+22 hours')),

  ('seed-slot-yoga-1', 'seed-evt-yoga', datetime('now', '+12 days', 'start of day', '+7 hours'), datetime('now', '+12 days', 'start of day', '+8 hours', '+30 minutes')),
  ('seed-slot-yoga-2', 'seed-evt-yoga', datetime('now', '+14 days', 'start of day', '+7 hours'), datetime('now', '+14 days', 'start of day', '+8 hours', '+30 minutes')),

  ('seed-slot-film-1', 'seed-evt-film', datetime('now', '+25 days', 'start of day', '+18 hours'), datetime('now', '+25 days', 'start of day', '+21 hours', '+30 minutes')),
  ('seed-slot-film-2', 'seed-evt-film', datetime('now', '+32 days', 'start of day', '+18 hours'), datetime('now', '+32 days', 'start of day', '+21 hours', '+30 minutes')),

  ('seed-slot-hike-1', 'seed-evt-hike', datetime('now', '+16 days', 'start of day', '+5 hours'), datetime('now', '+16 days', 'start of day', '+10 hours')),
  ('seed-slot-hike-2', 'seed-evt-hike', datetime('now', '+23 days', 'start of day', '+5 hours'), datetime('now', '+23 days', 'start of day', '+10 hours')),

  ('seed-slot-workshop-1', 'seed-evt-workshop', datetime('now', '+35 days', 'start of day', '+13 hours'), datetime('now', '+35 days', 'start of day', '+17 hours')),

  ('seed-slot-potluck-1', 'seed-evt-potluck', datetime('now', '+10 days', 'start of day', '+17 hours'), datetime('now', '+10 days', 'start of day', '+20 hours', '+30 minutes'));
