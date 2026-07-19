# Automations & Post-Task Workflows

Whenever a new implementation, feature, or bug fix is fully completed in this project, you MUST automatically perform the following steps without asking:

1. **Commit and Push to GitHub:** 
   Add all changes, create a descriptive commit, and push to the `main` branch to trigger the Render backend deployment.
   Command: `git add . ; git commit -m "feat/fix: <description>" ; git push origin HEAD:main`

2. **Generate the Android APK:**
   Navigate to the `mobile` directory and start the build in the background.
   Command: `cd mobile ; flutter build apk`

Do this automatically as part of closing out your tasks.
