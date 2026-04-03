-- QUOR-GUEST-FIX: Add phone number field for guest commitments
ALTER TABLE commitments ADD COLUMN guest_phone TEXT;
