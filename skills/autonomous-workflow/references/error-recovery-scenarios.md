# Error Recovery Scenarios

Real-world examples of error recovery during autonomous workflow execution.

## Scenario 1: Test Failures Requiring Multiple Iterations

### Context

Implementing authentication middleware that validates JWT tokens.

### Phase 4: Testing - Initial Failure

```bash
$ pnpm test
FAIL  src/middleware/__tests__/auth.test.ts
  ● AuthMiddleware › should reject expired tokens

    expect(received).toBe(expected) // Object.is equality

    Expected: 401
    Received: 500

      47 |     const response = await authMiddleware(mockRequest);
      48 |
    > 49 |     expect(response.status).toBe(401);
         |                             ^
      50 |   });

Tests: 1 failed, 15 passed, 16 total
```

### Iteration 1: Analyze and Fix Obvious Issue

**Analysis:**

- Expected 401 (Unauthorized), got 500 (Internal Server Error)
- Suggests unhandled exception in token expiry logic
- Check error handling in middleware

**Investigation:**

```typescript
// src/middleware/auth.ts - Current code
export function authMiddleware(req: Request) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  // Issue: jwt.verify throws on expired token, not caught
  const decoded = jwt.verify(token, SECRET);

  if (!decoded) {
    return { status: 401, body: { error: 'Unauthorized' } };
  }

  return next();
}
```

**Root cause:** `jwt.verify()` throws `TokenExpiredError` when token is expired, but we're not catching it.

**Fix:**

```typescript
export function authMiddleware(req: Request) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  try {
    const decoded = jwt.verify(token, SECRET);

    if (!decoded) {
      return { status: 401, body: { error: 'Unauthorized' } };
    }

    return next();
  } catch (error) {
    // Handle expired or invalid tokens
    if (error instanceof jwt.TokenExpiredError) {
      return { status: 401, body: { error: 'Token expired' } };
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return { status: 401, body: { error: 'Invalid token' } };
    }
    // Unexpected errors
    throw error;
  }
}
```

**Retest:**

```bash
$ pnpm test
FAIL  src/middleware/__tests__/auth.test.ts
  ● AuthMiddleware › should allow valid tokens

    TypeError: Cannot read property 'id' of undefined

Tests: 1 failed, 15 passed, 16 total
```

**Progress:** Fixed expired token test ✓, but broke another test ✗

### Iteration 2: Deep Analysis

**Analysis:**

- Different test now failing
- Error: "Cannot read property 'id' of undefined"
- Suggests decoded token not being passed to next handler

**Investigation:**

```typescript
// Test that's now failing
it('should allow valid tokens', async () => {
  const validToken = jwt.sign({ id: 'user123' }, SECRET);
  const mockRequest = {
    headers: { authorization: `Bearer ${validToken}` },
  };

  const response = await authMiddleware(mockRequest);

  // Expecting request to be modified with user data
  expect(mockRequest.user.id).toBe('user123');
});
```

**Root cause:** We're not attaching decoded token to request object before calling `next()`.

**Fix:**

```typescript
export function authMiddleware(req: Request) {
  const token = req.headers.authorization?.replace('Bearer ', '');

  try {
    const decoded = jwt.verify(token, SECRET);

    if (!decoded) {
      return { status: 401, body: { error: 'Unauthorized' } };
    }

    // Attach decoded token to request
    req.user = decoded;

    return next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { status: 401, body: { error: 'Token expired' } };
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return { status: 401, body: { error: 'Invalid token' } };
    }
    throw error;
  }
}
```

**Retest:**

```bash
$ pnpm test
FAIL  src/middleware/__tests__/auth.test.ts
  ● AuthMiddleware › should reject missing tokens

    expect(received).toBe(expected)

    Expected: 401
    Received: undefined

Tests: 1 failed, 15 passed, 16 total
```

**Progress:** Fixed valid token test ✓, but now missing token test fails ✗

### Iteration 3: Edge Case Handling

**Analysis:**

- Missing token test failing
- Returns `undefined` instead of 401
- Need to handle case where token is not provided

**Investigation:**

```typescript
// Current code doesn't check if token exists
const token = req.headers.authorization?.replace('Bearer ', '');

try {
  const decoded = jwt.verify(token, SECRET); // token could be undefined!
  // ...
}
```

**Root cause:** If `authorization` header is missing, `token` is `undefined`, and `jwt.verify(undefined)` behaves unexpectedly.

**Fix:**

```typescript
export function authMiddleware(req: Request) {
  const authHeader = req.headers.authorization;

  // Check for missing token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return { status: 401, body: { error: 'No token provided' } };
  }

  const token = authHeader.replace('Bearer ', '');

  try {
    const decoded = jwt.verify(token, SECRET);

    if (!decoded) {
      return { status: 401, body: { error: 'Unauthorized' } };
    }

    req.user = decoded;

    return next();
  } catch (error) {
    if (error instanceof jwt.TokenExpiredError) {
      return { status: 401, body: { error: 'Token expired' } };
    }
    if (error instanceof jwt.JsonWebTokenError) {
      return { status: 401, body: { error: 'Invalid token' } };
    }
    throw error;
  }
}
```

**Retest:**

```bash
$ pnpm test
PASS  src/middleware/__tests__/auth.test.ts

Tests: 16 passed, 16 total
✓ All tests passing!
```

### Summary

**Iterations:** 3
**Issues found:**

1. Unhandled exception on expired tokens (500 → 401)
2. Missing user data attachment to request
3. Missing token edge case not handled

**Resolution:** Comprehensive error handling with proper edge case coverage.

**Commits:**

```bash
$ git add src/middleware/auth.ts
$ git commit -m "fix(auth): add comprehensive error handling for JWT validation

- Catch and handle TokenExpiredError
- Catch and handle JsonWebTokenError
- Validate token presence before verification
- Attach decoded token to request object"
```

---

## Scenario 2: Dependency Installation Failure

### Phase 2: Worktree Setup - Installation Fails

```bash
$ gw add feat/stripe-integration
✓ Created worktree: feat/stripe-integration

$ gw cd feat/stripe-integration

$ pnpm install
 ERR_PNPM_FETCH_404  GET https://registry.npmjs.org/@types%2fstripe: Not Found - 404

This error happened while installing a direct dependency of /path/to/repo.git/feat/stripe-integration

@types/stripe is not in the npm registry, or you have no permission to fetch it.
```

### Recovery: Investigate Package Name

**Analysis:**

- Package `@types/stripe` not found
- Could be: wrong name, private package, or doesn't exist

**Investigation:**

```bash
# Check if package exists
$ npm search @types/stripe
No matches found

# Check actual Stripe types package
$ npm search stripe types
@stripe/stripe-js  Official Stripe.js types

# Check package.json
$ cat package.json | grep stripe
    "@types/stripe": "^8.0.0",
```

**Root cause:** Package name is wrong. Should be `stripe` (types included) or check if `@types/stripe` ever existed.

**Fix:**

```bash
# Check official Stripe documentation
# Found: Types are included in 'stripe' package itself

# Update package.json
$ cat > package.json <<EOF
{
  "dependencies": {
    "stripe": "^13.0.0"
  }
}
EOF

# Retry installation
$ pnpm install
✓ Dependencies installed successfully
```

**Validation:**

```bash
$ pnpm tsc --noEmit
✓ TypeScript recognizes Stripe types
```

**Commit:**

```bash
$ git add package.json pnpm-lock.yaml
$ git commit -m "fix(deps): use stripe package with built-in types

- Remove incorrect @types/stripe dependency
- Add stripe package (includes TypeScript definitions)"
```

### Summary

**Issue:** Incorrect dependency name
**Resolution:** Research correct package, update dependencies
**Time to resolve:** ~5 minutes
**Learning:** Always verify package names against official docs

---

## Scenario 3: Merge Conflict During Push

### Phase 6: PR Creation - Push Fails

```bash
$ git push -u origin feat/user-profile
To github.com:user/app.git
 ! [rejected]        feat/user-profile -> feat/user-profile (non-fast-forward)
error: failed to push some refs to 'github.com:user/app.git'
hint: Updates were rejected because the tip of your current branch is behind
hint: its remote counterpart. Integrate the remote changes (e.g.
hint: 'git pull ...') before pushing again.
```

### Recovery: Rebase and Resolve Conflicts

**Analysis:**

- Remote branch has new commits
- Need to integrate remote changes
- Possible conflicts

**Step 1: Fetch and Rebase**

```bash
$ git fetch origin
$ git rebase origin/feat/user-profile

Auto-merging src/components/UserProfile.tsx
CONFLICT (content): Merge conflict in src/components/UserProfile.tsx
Auto-merging src/types/user.ts
CONFLICT (content): Merge conflict in src/types/user.ts

Resolve all conflicts manually, mark them as resolved with
"git add/rm <conflicted_files>", then run "git rebase --continue".
```

**Step 2: Examine Conflicts**

```typescript
// src/types/user.ts - Conflict
export interface User {
  id: string;
  email: string;
  username: string; // Their change
  profile?: UserProfile;
}
```

**Step 3: Understand Both Changes**

**My change:** Added `displayName` field for user's visible name
**Their change:** Added `username` field for unique handle

**Decision:** Both changes are valid and non-conflicting, keep both.

**Step 4: Resolve Conflict**

```typescript
// src/types/user.ts - Resolved
export interface User {
  id: string;
  email: string;
  username: string; // Unique handle
  displayName: string; // Display name
  avatar?: string;
  profile?: UserProfile;
}
```

**Step 5: Resolve Component Conflict**

```typescript
// src/components/UserProfile.tsx - Conflict
<h1>@{user.username}</h1>
<div>{user.profile?.bio}</div>
```

**Resolution:** Show both username and display name

```typescript
// src/components/UserProfile.tsx - Resolved
<div>
  <h1>{user.displayName}</h1>
  <p className="text-gray-500">@{user.username}</p>
  {user.profile?.bio && <div>{user.profile.bio}</div>}
</div>
```

**Step 6: Test After Resolution**

```bash
$ pnpm tsc --noEmit
✓ No TypeScript errors

$ pnpm test
PASS  src/components/__tests__/UserProfile.test.tsx
PASS  src/types/__tests__/user.test.ts

Tests: 24 passed, 24 total
✓ All tests still pass
```

**Step 7: Complete Rebase**

```bash
$ git add src/types/user.ts src/components/UserProfile.tsx
$ git rebase --continue
Successfully rebased and updated refs/heads/feat/user-profile.

$ git push -u origin feat/user-profile
✓ Pushed successfully
```

### Summary

**Issue:** Remote branch diverged, merge conflicts
**Resolution:** Rebase with manual conflict resolution
**Conflicts:** 2 files (types and component)
**Validation:** Tests passed after resolution
**Time to resolve:** ~15 minutes

---

## Scenario 4: Build Failure After Implementation

### Phase 4: Testing - Build Fails Before Tests

```bash
$ pnpm build
src/lib/api-client.ts:15:22 - error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'string'.
  Type 'undefined' is not assignable to type 'string'.

15   return fetchAPI(endpoint, {
                        ~~~~~~~~

src/utils/format.ts:8:10 - error TS2339: Property 'toLocaleDateString' does not exist on type 'string | Date'.
  Property 'toLocaleDateString' does not exist on type 'string'.

8   return date.toLocaleDateString('en-US', options);
           ~~~~

Found 2 errors in 2 files.
```

### Recovery: Fix TypeScript Errors

**Error 1: Undefined endpoint parameter**

**Investigation:**

```typescript
// src/lib/api-client.ts
export async function getUser(id?: string) {
  // endpoint could be undefined if id is undefined
  const endpoint = id ? `/users/${id}` : undefined;

  return fetchAPI(endpoint, {
    // Error: endpoint might be undefined
    method: 'GET',
  });
}
```

**Root cause:** Not handling case where `id` is undefined.

**Fix:**

```typescript
export async function getUser(id?: string) {
  if (!id) {
    throw new Error('User ID is required');
  }

  const endpoint = `/users/${id}`;

  return fetchAPI(endpoint, {
    method: 'GET',
  });
}
```

**Alternative fix (if undefined is valid):**

```typescript
export async function getUser(id?: string) {
  const endpoint = id ? `/users/${id}` : '/users/me'; // Default to current user

  return fetchAPI(endpoint, {
    method: 'GET',
  });
}
```

**Error 2: String vs Date type confusion**

**Investigation:**

```typescript
// src/utils/format.ts
export function formatDate(date: string | Date) {
  // Error: string doesn't have toLocaleDateString
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
```

**Root cause:** Function accepts string but tries to call Date method.

**Fix:**

```typescript
export function formatDate(date: string | Date): string {
  // Ensure we have a Date object
  const dateObj = date instanceof Date ? date : new Date(date);

  // Check for invalid date
  if (isNaN(dateObj.getTime())) {
    throw new Error('Invalid date provided');
  }

  return dateObj.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
```

**Rebuild:**

```bash
$ pnpm build
✓ Compiled successfully in 3.2s
```

**Test:**

```bash
$ pnpm test
PASS  src/lib/__tests__/api-client.test.ts
PASS  src/utils/__tests__/format.test.ts

Tests: 28 passed, 28 total
```

**Commit:**

```bash
$ git add src/lib/api-client.ts src/utils/format.ts
$ git commit -m "fix(types): add proper type handling for optional params

- Add validation for required user ID parameter
- Handle string-to-Date conversion in formatDate
- Add invalid date checking"
```

### Summary

**Issue:** TypeScript compilation errors
**Resolution:** Add type guards and validation
**Errors fixed:** 2 (undefined handling, type conversion)
**Time to resolve:** ~10 minutes

---

## Scenario 5: Flaky Test Discovery

### Phase 4: Testing - Intermittent Failure

```bash
# First run
$ pnpm test
PASS  src/services/__tests__/cache.test.ts

# Second run
$ pnpm test
FAIL  src/services/__tests__/cache.test.ts
  ● CacheService › should expire cached items after TTL

    expect(received).toBe(expected)

    Expected: undefined
    Received: "cached-value"

# Third run
$ pnpm test
PASS  src/services/__tests__/cache.test.ts
```

### Recovery: Identify and Fix Flaky Test

**Analysis:**

- Test passes sometimes, fails others
- Classic sign of timing/async issue
- Need to make test deterministic

**Investigation:**

```typescript
// src/services/__tests__/cache.test.ts
describe('CacheService', () => {
  it('should expire cached items after TTL', async () => {
    const cache = new CacheService({ ttl: 100 }); // 100ms TTL

    cache.set('key', 'cached-value');

    // Wait for expiration
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Should be expired
    expect(cache.get('key')).toBe(undefined);
  });
});
```

**Root cause:** Race condition - we wait exactly 100ms, but expiration happens at 100ms, so timing varies based on execution speed.

**Fix: Add buffer time**

```typescript
it('should expire cached items after TTL', async () => {
  const cache = new CacheService({ ttl: 100 }); // 100ms TTL

  cache.set('key', 'cached-value');

  // Verify it exists immediately
  expect(cache.get('key')).toBe('cached-value');

  // Wait slightly longer than TTL to ensure expiration
  await new Promise((resolve) => setTimeout(resolve, 150)); // 50ms buffer

  // Should be expired
  expect(cache.get('key')).toBe(undefined);
});
```

**Better fix: Use fake timers**

```typescript
describe('CacheService', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should expire cached items after TTL', () => {
    const cache = new CacheService({ ttl: 100 });

    cache.set('key', 'cached-value');

    // Should exist before expiration
    expect(cache.get('key')).toBe('cached-value');

    // Fast-forward time by exactly 100ms
    jest.advanceTimersByTime(100);

    // Should be expired
    expect(cache.get('key')).toBe(undefined);
  });
});
```

**Validation: Run test 10 times**

```bash
$ for i in {1..10}; do pnpm test cache.test.ts; done
PASS (10/10 runs)
✓ Test is now deterministic
```

**Commit:**

```bash
$ git add src/services/__tests__/cache.test.ts
$ git commit -m "test(cache): fix flaky expiration test with fake timers

- Use jest.useFakeTimers() for deterministic time control
- Remove race condition from TTL testing
- Test now passes consistently"
```

### Summary

**Issue:** Flaky test (intermittent failures)
**Root cause:** Race condition with real timers
**Resolution:** Use fake timers for deterministic behavior
**Validation:** 10 consecutive successful runs
**Time to resolve:** ~20 minutes (diagnosis takes time)

---

## Key Takeaways

### Common Error Patterns

1. **Unhandled edge cases** → Add validation and error handling
2. **Timing issues** → Use fake timers or add buffers
3. **Type mismatches** → Add type guards and conversions
4. **Missing dependencies** → Verify package names and availability
5. **Merge conflicts** → Understand both changes, test after resolution

### Recovery Strategies

1. **Read error messages completely** - Don't skim
2. **Identify root cause, not symptoms** - Fix underlying issue
3. **Test after every fix** - Validate the fix worked
4. **Add guards to prevent recurrence** - Make code robust
5. **Never give up after fixed iterations** - Keep iterating

### Validation Checkpoints

After each error recovery:

- ✅ Build succeeds
- ✅ All tests pass
- ✅ Lint rules pass
- ✅ TypeScript errors cleared
- ✅ Commit with clear message explaining fix
