# 🚗 Car Auction Management Panel

A modern web-based platform for managing vehicle auctions, including listings, bidding, user management, and auction analytics.

The project is split into two independent applications:

- 🖥 **Frontend** - user interface for buyers, sellers, and admins  
- ⚙️ **Backend** - API, business logic, authentication, and auction engine  

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

## Access e2e tests

End-to-end tests for the access model (user group → auction group → auction → account, personal
access, GA account denials, `showAccounts`, auction-group `sessionLimit` including concurrent starts).
They run the real API against a real PostgreSQL + RabbitMQ and **truncate every table**, so they only
start when `TEST_DATABASE_URL` points to a database whose name contains `test`.

```bash
# 1. isolated infrastructure (Postgres on 55440, RabbitMQ on 55672)
docker compose -f docker-compose.test.yml up -d

# 2. apply migrations to the test database
DATABASE_URL=postgresql://postgres:test@localhost:55440/auctions_e2e_test npx prisma migrate deploy

# 3. run the tests
TEST_DATABASE_URL=postgresql://postgres:test@localhost:55440/auctions_e2e_test npm run test:e2e:access

# 4. clean up
docker compose -f docker-compose.test.yml down
```

`TEST_RABBITMQ_URL` overrides the default `amqp://localhost:55672`. Browser-worker sessions are only
queued, never started.
