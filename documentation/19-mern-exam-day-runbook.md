# 19 — How to Run the MERN Exam (Step by Step)

This guide explains how to run the **MERN-101 "MERN Stack Developer Assessment"** for 20 candidates from this PC. Follow the steps in order.

| | |
|---|---|
| **Exam** | `MERN-101`: 60 minutes, 30 single-choice questions in 4 sections (MongoDB 7, Express 7, React 9, Node.js 7), 2 marks each = 60 marks, pass mark 24 |
| **Proctoring** | Camera, microphone and fullscreen required. No ID verification. Answers are submitted automatically when time ends |
| **How candidates get in** | They open `<your link>/invite` and enter their full name, email and invite code |
| **Where it runs** | On this PC. A Cloudflare tunnel gives it a public HTTPS link |
| **Rehearsal copy** | `MERN-101-DRY` is identical and used only for testing; it never affects real candidates |

> **Before you start:** run every command in **PowerShell**, inside the folder `C:\Users\admin\Works\Kodeexam`. In VS Code: **Terminal → New Terminal**. If a command says a port is "already in use", that program is already running (for example from a Claude session); close that one first or use it as is.

---

## Part 1: The night before (about 10 minutes)

### Step 1: Start the database

Open **Terminal 1** and leave it running:

```powershell
npm run db:replset
```

Wait until it prints **`Replica set ready`**.

### Step 2: Review the questions

Open `demo/MERN-101-review.md` in VS Code. It lists all 30 questions with the correct answer marked ✅.

- **Keep this file private:** it contains the answer key.
- **To change questions:** edit `scripts/exam-data/mern-101.ts`, then run the command in Step 3 again. It updates the exam and rewrites the review file.

### Step 3: Set the exam time

In **Terminal 2**, run the following with **your** times:

```powershell
npx tsx scripts/setup-mern-exam.ts --start 2026-10-10T10:00:00+05:30 --end 2026-10-10T11:30:00+05:30
```

- `--start`: the earliest time a candidate can begin.
- `--end`: the latest time anyone can still be writing. Each candidate gets 60 minutes from when *they* start, but never past this time.
- `+05:30` means Indian Standard Time.

You can run it again at any time to change the window; it's safe to repeat.

### Step 4: Create the candidates' invite codes

1. Create a file called **`candidates.csv`** in the project folder, with one candidate per line as `Full Name,email`:

   ```
   Rahul Sharma,rahul.sharma@gmail.com
   Priya Nair,priya.nair@gmail.com
   Arjun Mehta,arjun.mehta@gmail.com
   ```

2. Create the invites:

   ```powershell
   npx tsx scripts/invite-bulk.ts MERN-101 candidates.csv --hours 48
   ```

3. The output shows where the codes were saved, for example `.data\invites\MERN-101-1791….csv`. Open that file to see each candidate's **code** (like `KP-7KQM-X3HD`).
   - **The codes appear only in this file.** The database stores them in a scrambled form, so they can't be looked up later.
   - Running the command again skips candidates who already have an active invite.

4. **Send each candidate their own code tonight.** The command prints a message template you can copy. **Don't send the website link yet**: it's created on exam morning (Part 2, Step 4).

---

## Part 2: Exam morning (start at least 1 hour early)

Open **four terminals** and **leave all of them running** for the whole exam.

### Step 1: Terminal 1, the database

```powershell
npm run db:replset
```

Wait for **`Replica set ready`**.

### Step 2: Terminal 2, the exam server

```powershell
npm run build
```

When the build finishes, run:

```powershell
$env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS='.trycloudflare.com'; $env:KPROCTOR_TRUST_PROXY='true'; $env:KPROCTOR_ALLOW_DEV_LAUNCH='false'; npx vite preview --port 3300 --strictPort
```

What these settings do:

| Setting | Why |
|---|---|
| `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS` | Lets the server answer requests that arrive through the Cloudflare link |
| `KPROCTOR_TRUST_PROXY=true` | Records each candidate's real IP, so limits and logs are per candidate |
| `KPROCTOR_ALLOW_DEV_LAUNCH=false` | Turns off developer test links; only invite codes work |

### Step 3: Terminal 3, the auto-submit worker

```powershell
npm run worker:expiry
```

It submits every exam whose time is up, even if the candidate has closed their browser.

### Step 4: Terminal 4, the public link

```powershell
cloudflared tunnel --no-autoupdate --url http://localhost:3300
```

After a few seconds it prints a link like:

```
https://some-random-words.trycloudflare.com
```

**Copy it.** This is your exam website for today. **It changes every time this command is restarted.**

### Step 5: Test everything (use a fifth terminal)

Replace `YOUR-LINK` with the link from Step 4:

```powershell
npx tsx scripts/exam-rehearsal.ts https://YOUR-LINK.trycloudflare.com --candidates 20
npx tsx scripts/exam-rehearsal-browser.ts https://YOUR-LINK.trycloudflare.com
npm run ops:status
```

Expected results:

| Command | You should see |
|---|---|
| `exam-rehearsal.ts` | `Completed: 20/20 candidates submitted` and `Database check: 20/20` |
| `exam-rehearsal-browser.ts` | Six ✓ lines and `no console errors` |
| `ops:status` | `"status": "ok"` |

These tests use the **rehearsal exam** and delete their test candidates afterwards; real candidates are never touched.

Also open `https://YOUR-LINK.trycloudflare.com/invite` in your own browser to see what candidates will see.

### Step 6: Send the link to candidates

Send everyone **`https://YOUR-LINK.trycloudflare.com/invite`** with these instructions:

- Use a **laptop or desktop** (phones are not supported) with **Google Chrome**, a **webcam** and a **microphone**.
- Enter your **full name exactly as invited**, your **invited email** and your **invite code**.
- Click **Allow** when Chrome asks for the camera and microphone; the system check needs both.
- Stay in **fullscreen** and on the exam tab. Leaving is recorded and a reminder is shown.
- An answer is saved only when **Save & Next** shows **"Saved"**. **End Exam** submits the exam.
- If the internet drops, open the link again and re-enter your details. Saved answers are kept, but **the timer keeps running**.

---

## Part 3: During the exam

**Do:**
- Keep **all four terminals open**.
- Keep this PC **plugged in and online**.

**Don't:**
- Close the laptop lid.
- Restart, or let Windows Update restart the PC. (Sleep is already set to *Never*.)

**Check health at any time** (in the fifth terminal):

```powershell
npm run ops:status
```

`"status": "ok"` means the auto-submit worker is running and no exam is overdue.

### If something goes wrong

| Problem | What to do |
|---|---|
| A candidate says their code is rejected | Check the exact **name** and **email** in your invites file. The message is deliberately the same for any mistake, so it doesn't reveal which part was wrong |
| A candidate lost their code | Find their invite id with `npx tsx scripts/invite-admin.ts list MERN-101`, revoke it with `npx tsx scripts/invite-admin.ts revoke <inviteId>`, then create a new one with `npx tsx scripts/invite-admin.ts create MERN-101 <email> "<Full Name>"` |
| **Terminal 4 (the link) stopped** | Run its command again. **The link changes**, so send the new link to everyone. Saved answers and timers are safe on the server; candidates re-enter their details at the new link and continue |
| Terminal 2 or 3 stopped | Run that terminal's command again. The worker catches up on any exam that ran out of time meanwhile |
| Terminal 1 (database) stopped | Run `npm run db:replset` again. Nothing saved is lost |
| This PC lost internet or power | Candidates can't save until it's back, and their time keeps running. Note who was affected; giving extra time needs a manual decision (there's no admin button for it yet) |

---

## Part 4: After the exam

1. Wait until every candidate's time has ended. `npm run ops:status` should show no overdue exams. The worker submits anyone who left without pressing End Exam.
2. **Close the public link:** press **Ctrl+C** in Terminal 4.
3. **Stop the worker and server:** press **Ctrl+C** in Terminals 3 and 2.
4. **Back up the results:** press **Ctrl+C** in Terminal 1 (database), then copy the whole `.data\mongodb-rs` folder somewhere safe (for example a USB drive or cloud storage).
5. **Scores:** a results/score export isn't built yet. All answers are stored safely and the answer key is on the server; a score export can be added on request.

---

## Quick reference

| What | Command |
|---|---|
| Start database | `npm run db:replset` |
| Set exam time / refresh questions | `npx tsx scripts/setup-mern-exam.ts --start <time> --end <time>` |
| Create invites from a list | `npx tsx scripts/invite-bulk.ts MERN-101 candidates.csv --hours 48` |
| List / revoke / create one invite | `npx tsx scripts/invite-admin.ts list MERN-101` · `revoke <id>` · `create MERN-101 <email> "<Name>"` |
| Build the app | `npm run build` |
| Start exam server | `$env:__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS='.trycloudflare.com'; $env:KPROCTOR_TRUST_PROXY='true'; $env:KPROCTOR_ALLOW_DEV_LAUNCH='false'; npx vite preview --port 3300 --strictPort` |
| Start auto-submit worker | `npm run worker:expiry` |
| Start public link | `cloudflared tunnel --no-autoupdate --url http://localhost:3300` |
| Load test (20 candidates) | `npx tsx scripts/exam-rehearsal.ts https://<link> --candidates 20` |
| Browser test | `npx tsx scripts/exam-rehearsal-browser.ts https://<link>` |
| Health check | `npm run ops:status` |

## Known limits

- **The quick-tunnel link** (`trycloudflare.com`) has no uptime guarantee and changes whenever Terminal 4 restarts. A free Cloudflare account with your own domain gives a permanent link.
- **Everything runs on this one PC.** If it goes down, the exam pauses for everyone (but time keeps running).
- **No AI face detection or screen monitoring.** The exam page says so honestly. Camera, microphone, fullscreen and tab events are recorded, but they never end an exam by themselves.
- **Invited candidates have no roll number**, so the header shows an empty "Roll No:".
