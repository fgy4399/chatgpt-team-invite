# v1.0.2

## Highlights
- Smoother admin entry with a brief fade + spinner during redirects.
- Admin entry link now goes straight to the dashboard when already signed in.

## Changes
- Auto-redirect from /admin to /admin/dashboard when a stored admin token exists.
- Add redirect transition and loading overlay for admin entry flows.
- Gate the transition on the home page so unauthenticated users go directly to /admin.

## Compatibility
- No breaking changes.
