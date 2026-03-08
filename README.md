# Finance Dashboard

A personal finance web app — recurring bill tracker, CSV transaction importer, and spending charts. Hosted on GitHub Pages; data stored in Firebase Firestore under your Google account so only you can access it.

---

## Setup Guide

### 1. Create a Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click **Add project** → name it (e.g. "FinanceDashboard") → Continue
3. Disable Google Analytics if you don't need it → **Create project**

### 2. Enable Google Sign-In

1. In the left sidebar: **Build → Authentication → Get started**
2. Under **Sign-in method**, enable **Google**
3. Set a support email → **Save**

### 3. Create a Firestore Database

1. Left sidebar: **Build → Firestore Database → Create database**
2. Choose **Start in production mode** → select a region → **Enable**
3. Go to the **Rules** tab and replace the default rules with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{document=**} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

4. Click **Publish**

### 4. Register a Web App & Get Your Config

1. Left sidebar: **Project Settings** (gear icon) → **General** tab
2. Scroll to **Your apps** → click the **</>** (Web) icon
3. Give it a nickname → click **Register app**
4. Copy the `firebaseConfig` object shown
5. Open `js/firebase-config.js` in this project and paste it in, replacing the placeholder values

### 5. Push to GitHub & Enable GitHub Pages

1. Create a new **public** repository on GitHub (the code is public but your data is not)
2. Push this entire `Bills/` folder to the repo root:

```bash
cd "C:\Users\Ty\Documents\Bills"
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO.git
git push -u origin main
```

3. In GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root) → Save**
4. Your site will be live at `https://YOUR_USERNAME.github.io/YOUR_REPO/`

### 6. Add Your GitHub Pages URL to Firebase

1. Back in Firebase Console → **Authentication → Settings → Authorized domains**
2. Click **Add domain** → paste your GitHub Pages URL (e.g. `your-username.github.io`)
3. Save

### 7. Done!

Open your site, click **Sign in with Google**, and start adding bills.

---

## Using the App

### Bills Tab
- Click **+ Add Bill** to add a recurring bill
- Select the month with the month picker
- Review your monthly total and what is due soon
- Quarterly bills (e.g. trash) automatically only show in their due months — just include the months in the "Due Day" field, e.g. `20th (Mar, Jun, Sept, Dec)`

### Transactions Tab
- Click **Import CSV** and select your bank's exported CSV
- The app will show a preview of new transactions (duplicates are automatically skipped)
- Click **Import Transactions** to save them
- Transactions that match a bill name are highlighted with a "recurring" badge
- Filter by month or category using the dropdowns

### Charts Tab
- Shows the last 6 months by default (change with the dropdown)
- **Income vs Expenses** — grouped bar chart by month
- **Monthly Spending by Category** — stacked bar; click a bar to drill into that month's category breakdown
- **Category Breakdown** — doughnut chart for the selected month
- **Top Merchants** — ranked list of where you spend the most

---

## CSV Format

The importer is built for your bank's export format with these columns:

```
Transaction ID, Posting Date, Effective Date, Transaction Type, Amount,
Check Number, Reference Number, Description, Transaction Category,
Type, Balance, Memo, Extended Description
```

If you use a different bank, you may need to adjust the `mapBankRow()` function in `js/transactions.js`.

---

## File Structure

```
Bills/
├── index.html              # App shell
├── css/style.css           # Styles
├── js/
│   ├── firebase-config.js  # ← Paste your Firebase config here
│   ├── auth.js
│   ├── db.js
│   ├── bills.js
│   ├── transactions.js
│   ├── charts.js
│   └── app.js
└── README.md
```
