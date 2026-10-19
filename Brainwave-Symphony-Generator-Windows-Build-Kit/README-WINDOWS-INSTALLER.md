# Brainwave Symphony Generator — Windows Build Kit

This kit converts the uploaded Next.js app into a desktop Windows application using Electron. It uses a local JSON file for the application's saved symphonies, steward profiles, session history, and ledger so a separate PostgreSQL installation is not needed.

## GitHub Actions build

1. Create an empty GitHub repository.
2. Extract this ZIP, then upload **everything inside the extracted folder** directly into the repository root.
3. Confirm `.github/workflows/build-windows-installer.yml` is at the repository root alongside `package.json`, `src`, `public`, `desktop`, and `next.config.ts`.
4. Commit the files, then open **Actions**.
5. When **Build Brainwave Symphony Generator Windows Launcher** succeeds, open its **Summary** and download `Brainwave-Symphony-Generator-Windows-Installers`.
6. Extract the artifact ZIP to find the Windows Setup `.exe` and portable `.exe`.

Node.js is used on GitHub's Windows build runner; it is not required on the target PC. User data is stored under the current Windows user's Electron app-data folder.

## Build notes

- The workflow uses `npm install` because the original archive does not include a synchronized lockfile for the added Electron packages.
- `next.config.ts` enables Next.js standalone output, and the packaging script copies the static assets into it.
- Runtime API routes use local JSON persistence rather than requiring a PostgreSQL service.
- This build kit still needs to be built in GitHub Actions and tested on Windows before its output can be considered verified.

## Audio safety note

This app generates audio tones. Start at a comfortable low volume and avoid prolonged exposure to loud audio. The app does not measure brain activity or establish a medical/therapeutic effect.
