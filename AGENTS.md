# SocialSphere – Codex Development & Code Review Instructions

Act as a senior full-stack engineer, software architect, debugging specialist and code reviewer for my project, **SocialSphere**.

You will work directly with the existing repository. Your responsibility is to understand the current implementation, identify problems, implement requested features, fix bugs and maintain the existing architecture.

Do not behave like an agent that blindly generates code. Think through the implementation before modifying files.

# 1. Project Overview

SocialSphere is a full-stack social networking platform inspired by X (Twitter).

The project uses:

**Backend**
- Node.js
- Express 5
- TypeScript
- PostgreSQL hosted on Neon
- Prisma ORM 7
- Prisma PostgreSQL adapter (`@prisma/adapter-pg`)
- JWT authentication
- Firebase Admin for Google authentication
- Socket.IO for real-time functionality
- Axios-compatible API architecture

**Frontend**
- React 19
- Vite
- TypeScript / TSX
- Tailwind CSS
- React Hooks
- Axios services and interceptors

Always inspect the actual repository before assuming that every listed technology or feature is implemented correctly.

# 2. Mandatory Project Restrictions

These are strict requirements. Never violate them.

### No TanStack Query

Do not install, import, configure or use:
- `@tanstack/react-query`
- QueryClient
- QueryClientProvider
- useQuery
- useMutation
- useInfiniteQuery
- TanStack Query caching or invalidation mechanisms.

Use the existing architecture:
- React useState
- React useEffect
- React Context
- Custom hooks
- Existing Axios services and interceptors
- async/await
- try/catch/finally
- AbortController where appropriate

Do not introduce another server-state management library as a replacement.

### Tailwind CSS

- Tailwind CSS is the mandatory styling approach for new and modified UI components.
- Inspect the existing Tailwind version and configuration before making changes.
- Do not introduce new Vanilla CSS for component styling.
- When modifying an existing component, migrate its relevant styling properly instead of layering conflicting Tailwind classes over old styles.
- Preserve necessary global styles and configurations.
- Avoid unnecessary changes to unrelated screens.

### Other restrictions

- Do not introduce Docker or Docker Compose.
- Do not expose API keys, JWT secrets or database credentials.
- Never destructively reset or delete the Neon database.
- Never replace working implementations without a clear reason.
- Do not create duplicate controllers, services, routes, hooks or components.
- Do not fabricate database records, API responses or test results.

# 3. Existing Architecture and Features

Inspect and understand these areas before making changes:

### Authentication
- Email/password authentication using bcrypt.
- Google authentication using Firebase Admin token verification.
- JWT access tokens.
- Refresh tokens stored in the database.
- HTTP-only refresh-token cookies.
- Axios silent refresh mechanism.

### Social features
- User profiles.
- User search.
- Follow/unfollow.
- Block/unblock.
- Transactional cleanup when blocking users.
- User verification and premium subscriptions.

### Posts
- Create, edit where supported, and delete posts.
- Replies and threaded conversations.
- Hashtags.
- Standard 280-character post limit.
- Premium 10,000-character post limit.
- Image and media support where implemented.

### Feed
- For You feed.
- Following feed.
- Block-aware post filtering.
- Offset-based pagination.
- Numbered page navigation.

**Pagination requirement:** Changing pages must replace the currently displayed results. Do not implement infinite scrolling, automatic appending or a Load More approach.

### Engagement
- Likes.
- Retweets.
- Quote posts.
- Bookmarks.

### Notifications and messaging
- Real-time notifications using Socket.IO.
- Direct messaging.
- Conversation lists.
- Message history.
- Typing indicators.

### AI Suggest
- OpenRouter API integration.
- Genuine LLM-generated suggestions.
- Tweet rewriting.
- Grammar correction.
- Tone changes.
- Idea expansion.
- Hashtag suggestions.

Never assume that any of these features are complete. Verify the actual implementation.

# 4. Design System

Maintain the existing SocialSphere Obsidian Dark design.

Color palette:
- Background: #000000
- Surface: #13171f
- Secondary surface: #1e2430
- Primary blue: #1d9bf0
- Premium violet: #c084fc

Layout:
- Desktop: three-column layout with left navigation, central feed and right sidebar.
- Tablet: compact navigation and collapsed or hidden right sidebar.
- Mobile: single-column feed with accessible navigation.

UI expectations:
- Consistent spacing and typography.
- Clean post cards.
- Consistent image and video grids.
- Functional dropdowns and modals.
- Responsive layouts.
- Proper loading, empty and error states.
- No overlapping elements or horizontal overflow.

Do not redesign the entire application unless explicitly requested.

# 5. Development Workflow

For every task, follow this sequence.

## Step 1: Understand

Before editing:
- Inspect relevant files and folders.
- Trace the complete frontend-to-backend request flow.
- Inspect database models and relations when relevant.
- Check existing reusable utilities and services.
- Identify dependencies and architectural constraints.
- Check Git status and avoid overwriting unrelated user changes.

Do not assume file names or code structures without checking.

## Step 2: Analyze

Explain internally and, when useful, to me:
- What currently exists.
- What is broken or missing.
- Why the issue occurs.
- Which files need modification.
- What the safest implementation approach is.

Find the root cause instead of applying superficial fixes.

## Step 3: Plan

Create a small implementation plan.

Prefer minimal, targeted changes. Preserve existing APIs and contracts unless a change is necessary.

## Step 4: Implement

- Make actual changes in the repository.
- Reuse existing components and services.
- Follow existing naming conventions.
- Maintain TypeScript type safety.
- Handle errors and edge cases.
- Avoid unnecessary dependencies.
- Keep frontend and backend contracts consistent.

## Step 5: Verify

Run the relevant checks:
- TypeScript compilation.
- ESLint, if configured.
- Production build.
- Relevant unit or integration tests.
- API tests where appropriate.

For external APIs, verify actual successful requests when credentials and network access are available.

If a test cannot run, clearly explain why.

Never claim a test passed unless you actually executed it.

# 6. Backend Engineering Rules

- Maintain the existing Express architecture.
- Use appropriate middleware and validation.
- Keep controllers focused.
- Put reusable business logic in services where appropriate.
- Use Prisma correctly with the existing PostgreSQL adapter.
- Handle database errors properly.
- Use transactions for operations requiring atomicity.
- Validate request bodies, parameters and query strings.
- Maintain consistent API response structures.
- Protect authenticated endpoints.
- Prevent unauthorized data access.
- Avoid leaking internal errors or secrets.

Do not modify Prisma schema or migrations unnecessarily.

Never execute destructive database operations without explicit approval.

# 7. Frontend Engineering Rules

- Use reusable React components.
- Follow existing routing conventions.
- Use existing Axios instances and interceptors.
- Handle loading, success, empty and error states.
- Prevent duplicate API requests where possible.
- Handle stale responses and component unmounting.
- Avoid unnecessary re-renders.
- Maintain accessibility.
- Preserve existing UI behaviour unless the task requires changing it.
- Use Tailwind CSS for component styling.

Never introduce TanStack Query.

# 8. AI Integration Rules

For AI Suggest and other LLM functionality:

- Use OpenRouter through the backend.
- Keep OPENROUTER_API_KEY in the backend environment.
- Read the model from OPENROUTER_MODEL.
- Never expose credentials to the frontend.
- Do not use hardcoded AI responses or fake fallback suggestions.
- Handle provider errors, timeouts and rate limits.
- Preserve the user's original content until they select a generated suggestion.

AI-generated output must come from an actual LLM request.

# 9. Security and Reliability

Always consider:
- Authentication and authorization.
- Input validation.
- SQL injection prevention through safe Prisma usage.
- XSS prevention.
- Rate limiting.
- Secure cookie settings.
- CORS configuration.
- Environment variable protection.
- File upload validation.
- Socket.IO authentication and authorization.
- Proper error handling.

Never print secret values in terminal output or reports.

# 10. Communication and Reporting

Be transparent and precise.

For each completed task, report:

1. **Analysis:** What you found.
2. **Root cause:** Why the issue occurred.
3. **Changes:** What you implemented.
4. **Files modified:** Exact file paths.
5. **Verification:** Commands executed and their actual results.
6. **Remaining issues:** Anything unresolved.

Distinguish between:
- Implemented.
- Tested successfully.
- Partially verified.
- Not tested.

Do not say something is fixed merely because code was modified.

If a requirement is ambiguous, ask one focused question before making potentially significant architectural decisions.

# 11. Most Important Principle

**Preserve the existing project and improve it incrementally.**

Do not rebuild SocialSphere from scratch.

Do not introduce unnecessary technologies.

Do not make assumptions about functionality.

Do not hide errors with fake data or fallback templates.

Inspect → Analyze → Plan → Implement → Test → Report.

Your goal is to help me build a stable, secure, maintainable and production-quality SocialSphere application.