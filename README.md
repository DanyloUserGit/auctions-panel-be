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

⚙️ Backend
📌 Overview

The backend handles business logic, auctions, bidding rules, authentication, and data storage.

🛠 Tech Stack (example)</br>

Node.js + NestJS</br>
PostgreSQL</br>
JWT Authentication

🚀 Setup </br>
cd backend</br>
npm install</br>
npm run dev</br>

🔑 Environment Variables

Create .env:

PORT=5000</br>
DATABASE_URL=postgresql://user:password@localhost:5432/auction</br>
JWT_SECRET=your_secret_key</br>
CORS_ORIGIN=http://localhost:5173</br>
