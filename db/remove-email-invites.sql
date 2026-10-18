-- Removes the old email invitations. Invite codes (db/invite-codes.sql) replace them.
-- Run this AFTER the app update is live, because the old app calls claim_invitations on sign-in.
-- Any email invitations that have not been accepted yet will be lost.

drop function if exists claim_invitations();
drop function if exists invite_member(uuid, text, text);
drop table if exists invitations;

notify pgrst, 'reload schema';
