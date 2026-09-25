# Mobile device test plan

**Status: not yet run.** The cloud environment used to build this project has
no Android/iOS device or emulator. Everything below the app's native layer
is covered by automated tests (offline store, outbox and sync engine against
a real database and PostgREST, the Android bundle build), but the camera,
GPS, SecureStore, SQLite on a real phone, push delivery and app-lifecycle
behaviour must be checked on hardware before release. Record the results in
the table at the end.

## Setup

1. A Supabase project with the migrations applied (docs/SETUP.md), one Super
   Admin, one supervisor and **two technicians**, one maintenance user, and
   a test site whose coordinates are where the tester stands (plus one far
   away). Use real, non-demo sites for the GPS tests.
2. Build a development or preview build with EAS (camera, notifications and
   SecureStore do not all work in Expo Go):
   `eas build --profile preview --platform android` (set `extra.eas.projectId`
   for push, see docs/SETUP.md).
3. Test on at least one low-end Android phone (2–3 GB RAM, Android 10+) and
   one current phone; iOS if the fleet includes iPhones.

## Checklist

### Sign-in and session
- [ ] Sign in with a technician account; the home tab lists today's work.
- [ ] Kill and reopen the app: still signed in (SecureStore session).
- [ ] Turn on airplane mode, kill and reopen: opens with the saved account,
      shows "Working offline".
- [ ] A deactivated account (Super Admin deactivates it): after reopening the
      app online, the account-status screen replaces the work tabs.

### Starting a PM (GPS)
- [ ] At the site: Start PM records the position; the web review shows
      "Within radius" with the distance.
- [ ] Away from the site (> radius): in *warn* mode the app asks for a reason
      and records it; in *block* mode (Settings) it refuses to start.
- [ ] Location permission denied: the app says so, and then follows the
      configured mode (warn: a reason is required; block: the PM cannot start).
- [ ] Location services off / no fix indoors: clear message, no crash.

### Checklist, readings and photos
- [ ] Answer items in every section; mark a section not applicable.
- [ ] Enter DC readings and phase currents; the calculated kW shows and
      matches V × A ÷ 1000.
- [ ] Take photos from the camera for a failing item; thumbnails appear;
      rotate the phone while the camera is open.
- [ ] Camera permission denied: explanation and a way to open settings.
- [ ] Submit with a required item missing: the app lists what is missing.
- [ ] Submit: status "Waiting to send" then "Sent"; the web shows the PM, its
      photos and the failures raised.

### Offline and sync
- [ ] Airplane mode: complete and submit a whole PM with 5+ photos; the sync
      bar shows the number waiting.
- [ ] Kill the app while offline; reopen: nothing lost.
- [ ] Back online: everything sends without pressing anything; photos arrive
      at full size in the web review.
- [ ] Poor network (throttle to 2G, or walk out of coverage mid-sync): sync
      resumes and does not duplicate answers, photos or failures.
- [ ] Supervisor returns the PM while the phone is offline: after sync the PM
      shows as returned with the comment and can be corrected and resubmitted.
- [ ] Two technicians on the same site: each sees only their own PMs.
- [ ] Sign out with unsent work: the app warns that it stays on the phone
      until the same account signs in again.

### Corrective actions (maintenance / technician)
- [ ] Assigned action appears after sync; start, add a note and photos,
      complete with a resolution — offline and online.
- [ ] Supervisor verifies on the web; the phone shows it as verified.

### Notifications
- [ ] Allow notifications: a PM assignment / returned PM / assigned action
      arrives as a push within a minute (app in background and killed).
- [ ] Tapping the push opens the right PM or action.
- [ ] Notifications denied: the in-app list still shows them after sync.

### Performance and robustness (low-end phone)
- [ ] Cold start to the home tab: note the time.
- [ ] Open a PM with all sections: scrolling is smooth; note any stutter.
- [ ] 20 PMs synced with photos: note the app's storage use (Settings › Apps)
      and whether it keeps growing after the photos are sent.
- [ ] Battery: a working day with the app open does not drain unusually
      (no GPS tracking in the background — location is read only at PM start).

## Results

| Date | Device / OS | Build | Tester | Passed | Issues (link) |
|---|---|---|---|---|---|
| | | | | | |
