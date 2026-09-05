# NexTurn

> **A centralized, real-time queue management platform for organizations and their users.**

---

## Table of Contents
- [Project Overview](#project-overview)
- [Problem Statement](#problem-statement)
- [The Solution](#the-solution)
- [Key Features](#key-features)
- [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)
- [How NexTurn Works](#how-nexturn-works)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Repository Structure](#repository-structure)
- [Security Implementation](#security-implementation)
- [Database Schema & Data Model](#database-schema--data-model)
- [Automated Testing & Verification](#automated-testing--verification)
- [Environment Variables](#environment-variables)
- [Local Development Setup](#local-development-setup)
- [Production Deployment Strategy](#production-deployment-strategy)
- [Project Verification Status](#project-verification-status)
- [Future Improvements](#future-improvements)

---

## Project Overview

**NexTurn** is a multi-tenant, real-time virtual queue management platform designed to eliminate physical waiting lines and streamline queue operations for organizations across various domains.

Rather than being restricted to a single industry (such as restaurant dining), NexTurn provides a flexible, domain-agnostic platform capable of managing queues across diverse organizational settings:

- **Restaurants & Dining** (table waiting lists, counter pick-ups)
- **Clinics & Healthcare** (patient check-ins, consultation queues)
- **Banks & Financial Institutions** (teller queues, advisory services)
- **Government & Municipal Offices** (document processing, permit applications)
- **Service & Repair Centers** (customer service counters, technical support)
- **Educational Institutions & Administrative Centers** (student services, advisory appointments)

---

## Problem Statement

Traditional physical queuing systems present significant operational and user experience challenges:

- **Unnecessary Waiting**: Customers are forced to physically stand or sit in crowded waiting areas, wasting time.
- **Lack of Visibility**: Users have no real-time insight into their current position in line or how many people remain ahead.
- **Unclear Waiting Times**: Service arrival times are unpredictable, causing anxiety and customer dissatisfaction.
- **Manual Queue Management**: Staff rely on paper tickets or verbal callouts, leading to errors, skipped turns, and operational bottlenecks.
- **Poor Communication**: Service delays or status updates are difficult to convey to waiting customers.
- **Queue Instability**: Handling cancellations, out-of-order service, or manual reordering risks gaps or duplicate ticket numbers.

---

## The Solution

NexTurn addresses these challenges with a modern, web-based digital queue infrastructure:

- **Instant QR Access**: Customers join queues instantly by scanning an admin-generated QR code or using an in-website camera scanner.
- **Real-Time Synchronized State**: WebSockets (Socket.IO) push instant position updates to customer and admin dashboards without page reloads.
- **Service-Duration Based Live ETA**: Waiting times are calculated dynamically using a rolling average of actual service durations per customer.
- **Centralized Admin Controls**: Staff can manage entries, reorder queues dynamically, mark entries complete, and compact remaining positions seamlessly.
- **Website-Only Real-Time Notifications**: In-app toasts and a persistent visual banner ("🎉 It's your turn!") alert users immediately when they reach position #1.
- **Multi-Tenant Security & RBAC**: Strict role-based access control enforces tenant isolation and backend-authoritative data protection.

---

## Key Features

### 🔐 Authentication & Session Management
- **Unified Login Portal**: Single login interface (`/login`) routing authenticated users according to their role (`SUPER_ADMIN`, `ADMIN`, `USER`).
- **Public Customer Signup**: Instant account creation (`/signup`) restricted strictly to the `USER` role.
- **JWT & Password Hashing**: JSON Web Tokens for authorization and `bcryptjs` hashing for secure password storage.
- **Session Persistence**: Browser `localStorage` session token hash ensures customer queue status persists across page refreshes and browser restarts.

### 🛡️ Role-Based Access Control (RBAC)
- **Role Hierarchy**: `SUPER_ADMIN` > `ADMIN` > `USER`.
- **Single Super Admin Guarantee**: Exactly one `SUPER_ADMIN` per tenant, created via secure environment bootstrap (`SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD`).
- **Admin Delegation**: Super Admin can create, inspect, and disable `ADMIN` accounts within their tenant.
- **Backend-Enforced Authorization**: All API endpoints independently authorize incoming requests against tenant and role constraints.

### 📋 Queue Management & Engine
- **First-Come, First-Served (FCFS)**: Deterministic, monotonic queue position assignment (`#1, #2, #3`).
- **Atomic Concurrency Protection**: Database row-level locking and transaction serializability prevent position collision or duplicate numbering during concurrent joins.
- **Automatic Queue Compaction**: When an entry is completed, cancelled, or removed, downstream positions automatically compact upward (`#3 -> #2`, `#2 -> #1`) without gaps.
- **Admin Controls**: Capabilities to complete (`DONE`), remove (`REMOVE`), or reorder (`REORDER`) waiting entries.
- **Customer Self-Service**: Customers can track position, view wait estimates, or cancel (`CANCEL`) their queue entry at any time.

### 📷 Camera QR Scanner & Entry Flow
- **Admin QR Generation**: Admins generate SVG/PNG QR codes encoding the public customer URL (`/queue/[queueId]`).
- **In-Website Camera Scanner**: Built-in camera scanner modal powered by `html5-qrcode` requesting browser camera permissions (`facingMode: "environment"`).
- **Auto Navigation**: Automatically detects NexTurn QR codes and redirects users directly to the corresponding queue page.
- **Manual Fallback**: Provides a text input fallback for devices without camera access or when camera permission is denied.

### ⚡ Real-Time WebSockets
- **Socket.IO Transport**: Bidirectional real-time communication between Express backend and Next.js frontend.
- **Room-Based Subscriptions**: Clients subscribe to tenant and queue rooms for targeted event broadcasts.
- **Automatic Reconnection**: Reconnects and resynchronizes queue state automatically upon network interruption.

### ⏱️ Service-Duration Based ETA
- **Accurate Service Tracking**: Captures `serviceStartedAt` when an entry reaches position `#1` and `completedAt` upon completion.
- **Pure Service Duration**: Measures actual service time per customer (`completedAt - serviceStartedAt`), preventing queue waiting time from distorting metrics.
- **Rolling Average**: Calculates estimated wait times using a 10-entry rolling average of completed service durations (with a 5-minute fallback per person).

### 🔔 Website-Only Real-Time Notifications
- **Zero Third-Party Dependencies**: Internal WebSocket-driven notification pipeline with no external SMS or messaging service fees.
- **Position Transition Alerts**: Toasts notify users when their position advances (`#3 -> #2`).
- **Turn Notification**: Prominent toast notification when reaching position `#1`.
- **Persistent Turn Banner**: Animated green banner ("🎉 It's your turn! Please proceed now to the counter.") remains displayed on the customer dashboard while serving.

---

## Role-Based Access Control (RBAC)

| Role | Provisioning | Capabilities |
| :--- | :--- | :--- |
| **`SUPER_ADMIN`** | Environment Bootstrap | • Provision and manage `ADMIN` accounts<br>• Full tenant management and administrative controls<br>• Access `/super-admin` portal<br>• Perform all Admin queue operations |
| **`ADMIN`** | Created by `SUPER_ADMIN` | • Create and configure organization queues<br>• Generate public QR codes<br>• Manage active queue entries (`DONE`, `REMOVE`, `REORDER`)<br>• Access `/admin/dashboard` |
| **`USER`** | Public Self-Signup | • Create customer account<br>• Scan QR codes via built-in camera scanner or open URL<br>• Join queues and receive deterministic positions<br>• Track live position, people ahead, and service ETA<br>• Receive real-time browser notifications<br>• Self-cancel or view own queue entry |

---

## How NexTurn Works

```mermaid
sequenceDiagram
    autonumber
    actor SA as Super Admin
    actor A as Admin
    actor U as User / Customer
    participant W as Next.js Web App
    participant B as Express API & Socket.IO
    participant DB as PostgreSQL Database

    Note over SA, DB: 1. Provisioning & Queue Setup
    SA->>B: Login (/login)
    B-->>SA: Return JWT Token (SUPER_ADMIN)
    SA->>B: Create Admin Account (/api/admin/users)
    B->>DB: Store Admin record
    A->>B: Login (/login)
    B-->>A: Return JWT Token (ADMIN)
    A->>B: Create Queue (/api/queues)
    B->>DB: Save Queue record
    A->>W: Generate & Display Public Queue QR Code

    Note over U, DB: 2. Customer Join & Real-Time Tracking
    U->>W: Scan QR Code or Open Link (/queue/[queueId])
    U->>B: Join Queue (/api/queues/[id]/join)
    B->>DB: Atomic Lock & Save QueueEntry (Position #N)
    B-->>W: Return Entry & Session Token
    B->>W: Broadcast Socket Event (queue:updated)
    W-->>U: Display Live Position, ETA & Join Notification

    Note over A, DB: 3. Admin Operations & Turn Notification
    A->>B: Mark Entry #1 DONE (/api/queues/[id]/entries/[entryId]/done)
    B->>DB: Update Entry Status & Compact Remaining Positions (#2 -> #1)
    B->>W: Broadcast Socket Event (queue:updated)
    W-->>U: Trigger "It's Your Turn!" Toast & Persistent Banner
```

---

## System Architecture

NexTurn is structured as a decoupled monorepo architecture utilizing Next.js for the client application and Express.js with Prisma and Socket.IO for the backend server.

```mermaid
graph TD
    subgraph Frontend ["Frontend Layer (apps/web)"]
        UI["Next.js App Router"]
        Scanner["Camera QR Scanner (html5-qrcode)"]
        SocketClient["Socket.IO Client"]
    end

    subgraph Backend ["Backend API Layer (apps/api)"]
        Express["Express.js Server"]
        AuthMiddleware["JWT & RBAC Middleware"]
        QueueEngine["Queue Engine & Concurrency Handler"]
        SocketServer["Socket.IO Server"]
    end

    subgraph Database ["Data & Persistence Layer"]
        Prisma["Prisma ORM"]
        Postgres[("PostgreSQL / Supabase")]
    end

    UI <-->|HTTP / REST API| Express
    SocketClient <-->|WebSockets / Polling| SocketServer
    Express --> AuthMiddleware
    AuthMiddleware --> QueueEngine
    QueueEngine --> Prisma
    Prisma --> Postgres
```

---

## Tech Stack

### Frontend (`apps/web`)
- **Framework**: Next.js (App Router), React 19
- **Language**: TypeScript
- **Styling**: Tailwind CSS
- **Real-Time Client**: `socket.io-client`
- **QR Scanner**: `html5-qrcode`

### Backend (`apps/api`)
- **Runtime**: Node.js (>=18)
- **Framework**: Express.js
- **Real-Time Server**: Socket.IO
- **Database ORM**: Prisma ORM
- **Database**: PostgreSQL (Supabase)
- **Security & Utilities**: `jsonwebtoken`, `bcryptjs`, `helmet`, `cors`, `express-rate-limit`, `zod`

### Monorepo Architecture & Infrastructure
- **Monorepo Manager**: Turborepo, `pnpm` Workspaces
- **Shared Packages**: `@nexturn/types`, `@nexturn/validation`, `@nexturn/config`, `@nexturn/ui`
- **Git Hooks & Formatting**: Husky, Prettier

### Testing & Quality Assurance
- **Unit & Integration Testing**: Jest, Supertest
- **End-to-End Testing**: Playwright

---

## Repository Structure

```
NexTurn/
├── apps/
│   ├── api/                    # Express.js backend API & Socket.IO server
│   │   ├── prisma/             # Prisma schema & database migrations
│   │   ├── src/                # Controllers, routes, middleware & queue engine
│   │   ├── tests/              # Jest unit and integration tests
│   │   └── package.json
│   └── web/                    # Next.js frontend web application
│       ├── app/                # Next.js App Router pages (/login, /dashboard, /admin, etc.)
│       ├── components/         # UI components & QR scanner modal
│       └── package.json
├── packages/
│   ├── config/                 # Shared TypeScript & ESLint configurations
│   ├── types/                  # Shared TypeScript interfaces & types
│   ├── ui/                     # Shared UI component library
│   └── validation/             # Shared Zod validation schemas
├── tests/
│   ├── e2e/                    # Playwright E2E test suite
│   └── playwright.config.ts
├── docs/
│   ├── verification-report.md  # Comprehensive product verification report
│   └── screenshots/            # Verification screenshot evidence (28 screenshots)
├── .env.example                # Template for environment configuration
├── package.json                # Root monorepo package.json
├── pnpm-workspace.yaml         # pnpm workspace definition
└── turbo.json                  # Turborepo pipeline configuration
```

---

## Security Implementation

- **JWT Authentication**: Token-based authentication with expiration enforcement for protected API routes.
- **Bcrypt Password Hashing**: Passwords stored as salt-hashed strings using `bcryptjs`.
- **Backend-Authoritative RBAC**: Middleware strictly validates caller identity, tenant boundaries, and permissions (`SUPER_ADMIN`, `ADMIN`, `USER`).
- **Tenant Data Isolation**: Database queries enforce `tenantId` filtering across all tables (`tenants`, `users`, `queues`, `queue_entries`, `queue_events`).
- **Session Token Authorization**: Public queue entries are secured via unique `sessionTokenHash` validation in the `x-session-token` header.
- **HTTP Security Headers**: Powered by `helmet` to protect against common web vulnerabilities.
- **CORS Policies**: Explicit origin restrictions preventing unauthorized cross-origin API requests.
- **Rate Limiting**: `express-rate-limit` guards against brute-force authentication and spam requests.
- **Input Validation**: `zod` schema validation sanitizes all incoming API request payloads.
- **Environment Variable Protection**: Secrets excluded from version control via `.gitignore`. No hardcoded credentials exist in code.

---

## Database Schema & Data Model

NexTurn uses PostgreSQL managed through Prisma ORM.

### Data Models
- **`Tenant`**: Represents an organization (`id`, `name`, `slug`, `status`).
- **`User`**: Accounts scoped to a tenant with assigned roles (`SUPER_ADMIN`, `ADMIN`, `USER`).
- **`Queue`**: Active queues created under a tenant (`id`, `name`, `status`, `joinEnabled`).
- **`QueueEntry`**: Customer queue records (`id`, `queueId`, `userId`, `name`, `phone`, `status`, `position`, `serviceStartedAt`, `completedAt`).
- **`QueueEvent`**: Immutable audit logs capturing queue activity (`QUEUE_JOINED`, `QUEUE_COMPLETED`, `QUEUE_CANCELLED`, `QUEUE_REMOVED`, `QUEUE_REORDERED`).

---

## Automated Testing & Verification

The NexTurn codebase has undergone comprehensive automated testing and product verification:

| Test Suite / Verification Layer | Tool / Framework | Verified Result | Status |
| :--- | :--- | :--- | :---: |
| **Backend Unit & Integration Tests** | Jest & Supertest | 25 / 25 Tests Passed | `PASSED` |
| **End-to-End Automated Flows** | Playwright | Full User Journey Verified | `PASSED` |
| **Camera QR Scanner E2E Coverage** | Playwright / Headless Chromium | Camera Permissions & Fallback Verified | `PASSED` |
| **TypeScript Type Safety** | `tsc --noEmit` | 0 Type Errors Across Monorepo | `PASSED` |
| **Next.js Production Build** | `next build` | Production Bundle Compiled Successfully | `PASSED` |
| **Turborepo Monorepo Build** | `turbo run build` | All Apps & Packages Built Cleanly | `PASSED` |
| **Product Verification Audit** | Manual & Automated Flows | 28 Screenshot Evidence Artifacts | `PASSED` |

Detailed verification logs and screenshot evidence are documented in [`docs/verification-report.md`](file:///c:/Users/darsh/OneDrive/Desktop/Projects/NexTurn/docs/verification-report.md).

---

## Environment Variables

Copy `.env.example` to `.env` in the appropriate directories and configure your values:

```env
# Database Connection (PostgreSQL / Supabase)
DATABASE_URL="postgresql://user:password@localhost:5432/nexturn?schema=public"

# Authentication Security
JWT_SECRET="your_secure_jwt_secret_key_here"

# Super Admin Initial Bootstrap Credentials
SUPER_ADMIN_EMAIL="superadmin@example.com"
SUPER_ADMIN_PASSWORD="your_secure_super_admin_password"

# Server Port Configurations
PORT=4000
NEXT_PUBLIC_API_URL="http://localhost:4000"
```

> [!IMPORTANT]
> Never commit real credentials, tokens, or secret keys to version control. Always use placeholder values in documentation.

---

## Local Development Setup

### Prerequisites
- **Node.js**: `>=18.0.0`
- **Package Manager**: `pnpm` (`v11.25.0` recommended)
- **Database**: PostgreSQL database instance

### Setup Instructions

1. **Clone the Repository**
   ```bash
   git clone https://github.com/darshu-22/NexTurn.git
   cd NexTurn
   ```

2. **Install Dependencies**
   ```bash
   pnpm install
   ```

3. **Configure Environment Variables**
   ```bash
   cp .env.example .env
   ```

4. **Generate Prisma Client & Apply Database Migrations**
   ```bash
   # Generate Prisma Client
   pnpm --filter @nexturn/api db:generate

   # Apply Migrations
   npx prisma migrate deploy --schema=apps/api/prisma/schema.prisma
   ```

5. **Start Development Servers**
   ```bash
   pnpm dev
   ```
   - **Frontend App**: `http://localhost:3000`
   - **Backend API & WebSockets**: `http://localhost:4000`

6. **Run Verification & Tests**
   ```bash
   # Run Backend Jest API Tests
   pnpm --filter @nexturn/api test

   # Run Monorepo Build Check
   pnpm build
   ```

---

## Production Deployment Strategy

- **Frontend (`apps/web`)**: Designed for deployment on **Vercel** or Next.js hosting platforms.
- **Backend API (`apps/api`)**: Deployed to Node.js hosting environments (e.g. AWS ECS, Render, Railway, DigitalOcean) with WebSocket support for Socket.IO.
- **Database**: Managed via **Supabase PostgreSQL** or cloud-hosted PostgreSQL instances.
- **Environment Secrets**: Secrets and environment variables configured through host platform configuration management.

---

## Project Verification Status

The current NexTurn core implementation has completed:
- [x] Unified Authentication & Customer Signup
- [x] Multi-Tenant Role-Based Access Control (RBAC)
- [x] First-Come, First-Served Queue Engine with Concurrency Safety
- [x] Admin Queue Operations (DONE, REMOVE, REORDER)
- [x] Dynamic QR Code Generation & Built-In Camera Scanner Modal
- [x] Socket.IO Real-Time Position Updates & Reconnection Handling
- [x] Rolling Average Service Duration-Based ETA Calculation
- [x] Website-Only Real-Time Notifications & Persistent Turn Banner
- [x] Security Audit & Zero-Secrets Verification
- [x] Automated Unit, Integration, and E2E Test Verification

*Note: Production cloud deployment setup is ready for execution as a subsequent milestone.*

---

## Future Improvements

Planned future enhancements:
- [ ] PWA Web Push / Web Notifications API for background browser tab alerts
- [ ] Advanced Queue Analytics & Peak-Hour Performance Dashboard
- [ ] Multi-Language (i18n) Support
- [ ] Custom Branding & Organization Themes per Tenant
- [ ] SMS / WhatsApp Alert Integrations for users without active mobile data
