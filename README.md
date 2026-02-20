# 🚗 Car Auction Management Panel

A modern web-based platform for managing vehicle auctions, including listings, bidding, user management, and auction analytics.

The project is split into two independent applications:

- 🖥 **Frontend** — user interface for buyers, sellers, and admins  
- ⚙️ **Backend** — API, business logic, authentication, and auction engine  

---

## ✨ Features

### 🔹 Core Functionality
- Vehicle listing management
- Real-time bidding system
- Auction scheduling & timers
- User roles (Admin, Seller, Buyer)
- Secure authentication & authorization
- Auction history & analytics
- Image uploads for vehicles

### 🔹 Admin Capabilities
- Manage users and roles
- Approve/reject listings
- Monitor live auctions
- View financial reports

---

## 🏗 Project Structure

---

# 🖥 Frontend

## 📌 Overview
The frontend provides a responsive interface for browsing auctions, placing bids, and managing vehicle listings.

## 🛠 Tech Stack (example)
- React
- TypeScript
- Tailwind CSS / Material UI
- Axios / Fetch API

## 🚀 Setup

🔑 Environment Variables

Create .env: </br>
VITE_API_URL=http://localhost:8000/api

```bash
cd frontend
npm install
npm run dev
