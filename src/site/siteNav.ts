// The public site's addresses. Navigation itself is React Router (src/main.tsx); /app is the dashboard.

export const PUBLIC_PATHS = ['/', '/features', '/pricing', '/contact', '/signup', '/privacy', '/terms', '/refund-policy', '/data-deletion'] as const;
export type PublicPath = typeof PUBLIC_PATHS[number];

/** Is this address one of the public pages (else: the dashboard / sign-in, or not found)? */
export function isPublicPath(path: string): boolean {
  const p = path.replace(/\/+$/, '') || '/';
  return (PUBLIC_PATHS as readonly string[]).includes(p);
}
