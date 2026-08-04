// Up to two uppercase initials from a display name, falling back to the email
// local-part so an account with no name still gets a stable monogram.
export function initialsFor(fullName: string | null | undefined, email = ''): string {
  const name = (fullName ?? '').trim();
  if (name) {
    return name.split(' ').filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
  }
  return (email.split('@')[0] || 'U').slice(0, 2).toUpperCase();
}
