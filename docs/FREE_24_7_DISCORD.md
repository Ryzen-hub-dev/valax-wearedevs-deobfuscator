# Free 24/7 Discord deployment

The Valax web application remains on Vercel Hobby. The Discord Gateway and voice process must run on an always-on machine because a Vercel Function has a finite invocation duration and cannot own a permanent Discord voice session.

## Current zero-cost fallback: the Windows host

Run this once from the repository:

```powershell
npm run discord:install-startup
```

This installs the current-user scheduled task `Valax Discord Bot`. It starts at sign-in and runs `scripts/discord-supervisor.js`, which automatically restarts the bot after a crash. The computer must stay awake and connected to the internet.

Logs are stored in `apps/discord-bot/data/supervisor.log`. Community data is stored in the same ignored data directory.

## True remote 24/7: Google Cloud Free Tier

Google Cloud currently includes one non-preemptible `e2-micro` VM for the full number of hours in each month when it is created in an eligible US region. A billing account is required, so configure a budget alert and use only the documented Free Tier machine, disk, and egress limits.

1. Create an Ubuntu `e2-micro` VM in `us-west1`, `us-central1`, or `us-east1` with a standard persistent disk of 30 GB or less.
2. Install Docker and the Docker Compose plugin.
3. Clone this repository to the VM.
4. Transfer `.env.bot.local` to the repository root using a secure channel. Never commit it.
5. Start the published bot image:

```bash
docker compose -f infra/docker/docker-compose.free-bot.yml up -d
```

6. Restrict TCP port `3080` to Vercel's status proxy or put it behind HTTPS. Set Vercel environment variable `COMMUNITY_WORKER_STATUS_URL` to that public worker origin, then redeploy. The Vercel dashboard will proxy live aggregate status from `/api/community-status`.

Use `LOCAL_RECOVERY_ENABLED=false` on the small VM. Heavy recovery stays in the existing Vercel recovery API while the VM handles Discord Gateway, voice, tickets and community state.

## Other free tiers

- Oracle Cloud Always Free compute is also capable of a permanent process, subject to regional capacity.
- Koyeb Free and Render Free web services scale down after idle periods, so they are not reliable for an always-connected Discord voice bot without artificial keepalive traffic. This project intentionally does not implement self-pinging workarounds.

Official references:

- <https://vercel.com/docs/functions/limitations>
- <https://vercel.com/docs/cron-jobs/usage-and-pricing>
- <https://docs.cloud.google.com/free/docs/free-cloud-features>
- <https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm>
