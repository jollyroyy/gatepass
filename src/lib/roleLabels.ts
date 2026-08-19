// What a role is CALLED on screen, in one place.
//
// It used to live in SidebarProfile.tsx, which was fine while the sidebar was
// the only thing that printed it. The identity chip moved to the top right
// (client, 2026-08-19) and the profile page reads it too, so a label owned by
// one component became a label three of them import — and a component that
// exists to draw a box is the wrong owner for a vocabulary.
//
// A DIRECT LOOKUP, never a string match on the role. `super_admin` reads
// "Admin" deliberately: the distinction is a permission, not a job title, and
// the person holding it introduces themselves as the admin.
import type { UserRole } from '../types';

export const ROLE_LABELS: Record<UserRole, string> = {
  guard: 'Security',
  hod: 'HOD',
  admin: 'Admin',
  super_admin: 'Admin',
  staff: 'Staff',
};
