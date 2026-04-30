# Iterative Refinement in Autonomous Workflow

Examples showing how continuous iteration and self-validation improve code quality throughout implementation.

## Concept

**Iterative refinement** means validating and improving work at every step, not just at the end. Each phase includes self-review checkpoints to catch issues early.

## Example 1: API Client Implementation with Progressive Refinement

### User Request

"Add retry logic to API client for network resilience"

---

### Phase 3: Implementation - Iteration 1 (Initial Draft)

**First implementation:**

```typescript
// src/lib/api-client.ts
export async function fetchAPI(endpoint: string, options: RequestInit) {
  const url = `${API_BASE}${endpoint}`;

  try {
    const response = await fetch(url, options);
    return response.json();
  } catch (error) {
    // Add retry logic
    const response = await fetch(url, options);
    return response.json();
  }
}
```

**Self-review checkpoint:**

Questions to ask:

- ✓ Does it compile?
- ✓ Does it follow existing patterns?
- ❌ Is this the simplest solution? **No - hardcoded single retry**
- ❌ Does it handle all edge cases? **No - what if retry also fails?**
- ❌ Is naming clear? **"retry logic" but only retries once**

**Decision:** Refine before committing

---

### Iteration 2 (Improved)

```typescript
// src/lib/api-client.ts
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000;

export async function fetchAPI(endpoint: string, options: RequestInit) {
  const url = `${API_BASE}${endpoint}`;
  let lastError: Error;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const response = await fetch(url, options);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.json();
    } catch (error) {
      lastError = error as Error;

      // Don't retry on last attempt
      if (attempt < MAX_RETRIES - 1) {
        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY));
      }
    }
  }

  throw lastError!;
}
```

**Self-review checkpoint:**

Questions:

- ✓ Does it compile? **Yes**
- ✓ Handles multiple retries? **Yes**
- ✓ Has delay between retries? **Yes**
- ❌ Should delay be exponential? **Probably better**
- ❌ Should all errors be retried? **No - 404 shouldn't retry**
- ❌ Is delay configurable? **No - hardcoded**

**Decision:** Refine further

---

### Iteration 3 (Better Edge Case Handling)

```typescript
// src/lib/api-client.ts
const MAX_RETRIES = 3;
const INITIAL_RETRY_DELAY = 1000;

interface FetchOptions extends RequestInit {
  maxRetries?: number;
  retryDelay?: number;
}

// Errors that should not be retried
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 422]);

function isRetryableError(error: Error, status?: number): boolean {
  // Don't retry client errors
  if (status && NON_RETRYABLE_STATUS.has(status)) {
    return false;
  }

  // Retry network errors and server errors
  return true;
}

export async function fetchAPI(endpoint: string, options: FetchOptions = {}): Promise<any> {
  const { maxRetries = MAX_RETRIES, retryDelay = INITIAL_RETRY_DELAY, ...fetchOptions } = options;

  const url = `${API_BASE}${endpoint}`;
  let lastError: Error;
  let lastStatus: number | undefined;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await fetch(url, fetchOptions);
      lastStatus = response.status;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      lastError = error as Error;

      // Check if error is retryable
      if (!isRetryableError(lastError, lastStatus)) {
        throw lastError;
      }

      // Don't delay after last attempt
      if (attempt < maxRetries - 1) {
        // Exponential backoff: delay * (2 ^ attempt)
        const delay = retryDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}
```

**Self-review checkpoint:**

Questions:

- ✓ Does it compile? **Yes**
- ✓ Exponential backoff? **Yes**
- ✓ Configurable? **Yes**
- ✓ Skips non-retryable errors? **Yes**
- ✓ Clear naming? **Yes**
- ✓ Matches existing patterns? **Yes**
- ✓ Simple enough? **Yes - no over-engineering**

**Decision:** Ready to commit

---

### Iteration 4 (Add Tests - Discover Issue)

```typescript
// src/lib/__tests__/api-client.test.ts
describe('fetchAPI retry logic', () => {
  it('should retry on network errors', async () => {
    const mockFetch = jest
      .fn()
      .mockRejectedValueOnce(new Error('Network error'))
      .mockRejectedValueOnce(new Error('Network error'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ data: 'success' }),
      });

    global.fetch = mockFetch;

    const result = await fetchAPI('/test');

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ data: 'success' });
  });

  it('should not retry on 404 errors', async () => {
    const mockFetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => ({}),
    });

    global.fetch = mockFetch;

    await expect(fetchAPI('/test')).rejects.toThrow('HTTP 404');

    expect(mockFetch).toHaveBeenCalledTimes(1); // No retries
  });
});
```

**Run tests:**

```bash
$ pnpm test api-client
FAIL  src/lib/__tests__/api-client.test.ts
  ● should retry on network errors

    expect(jest.fn()).toHaveBeenCalledTimes(expected)

    Expected: 3
    Received: 2

    Test shows our retry logic stopped after 2 attempts instead of 3
```

**Issue discovered:** `maxRetries` means "total attempts" but our loop only retries `maxRetries - 1` times.

**Fix (Iteration 5):**

```typescript
export async function fetchAPI(endpoint: string, options: FetchOptions = {}): Promise<any> {
  const { maxRetries = MAX_RETRIES, retryDelay = INITIAL_RETRY_DELAY, ...fetchOptions } = options;

  const url = `${API_BASE}${endpoint}`;
  let lastError: Error;
  let lastStatus: number | undefined;

  // Initial attempt + retries = maxRetries total attempts
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Changed < to <=
    try {
      const response = await fetch(url, fetchOptions);
      lastStatus = response.status;

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      return response.json();
    } catch (error) {
      lastError = error as Error;

      if (!isRetryableError(lastError, lastStatus)) {
        throw lastError;
      }

      // Don't delay after last attempt
      if (attempt < maxRetries) {
        // Changed condition
        const delay = retryDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError!;
}
```

**Retest:**

```bash
$ pnpm test api-client
PASS  src/lib/__tests__/api-client.test.ts

Tests: 2 passed, 2 total
✓ Tests passing
```

**Commit:**

```bash
$ git add src/lib/api-client.ts
$ git commit -m "feat(api): add retry logic with exponential backoff

- Configurable max retries and initial delay
- Exponential backoff (delay * 2^attempt)
- Skip retries for client errors (4xx)
- Retry network and server errors (5xx)"
```

---

### Summary of Refinement Process

**Iterations:**

1. Initial draft → Self-review revealed inadequate retry logic
2. Multiple retries → Self-review revealed missing edge cases
3. Better edge cases → Self-review confirmed ready to test
4. Tests added → Tests revealed off-by-one error
5. Bug fixed → Final implementation validated

**Key principle:** Don't commit first draft. Self-review and refine until code is clean.

---

## Example 2: Form Validation Component with Iterative UX Improvements

### User Request

"Add email validation to signup form"

---

### Phase 3: Implementation - Iteration 1

**Initial implementation:**

```typescript
// src/components/SignupForm.tsx
export function SignupForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');

  const validateEmail = (email: string) => {
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validateEmail(email)) {
      setError('Invalid email');
      return;
    }

    // Submit form...
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />
      {error && <div>{error}</div>}
      <button type="submit">Sign Up</button>
    </form>
  );
}
```

**Self-review:**

- ✓ Validates email format
- ❌ When does validation happen? **Only on submit - poor UX**
- ❌ Error message helpful? **"Invalid email" is vague**
- ❌ Accessible? **No aria attributes**

**Decision:** Improve UX before committing

---

### Iteration 2 (Better UX)

```typescript
export function SignupForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [touched, setTouched] = useState(false);

  const validateEmail = (email: string): string | null => {
    if (!email) {
      return 'Email is required';
    }
    if (email.length < 3) {
      return 'Email is too short';
    }
    if (!email.includes('@')) {
      return 'Email must contain @';
    }
    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!regex.test(email)) {
      return 'Please enter a valid email address';
    }
    return null;
  };

  const handleBlur = () => {
    setTouched(true);
    const validationError = validateEmail(email);
    setError(validationError || '');
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value;
    setEmail(newEmail);

    // Validate while typing if already touched
    if (touched) {
      const validationError = validateEmail(newEmail);
      setError(validationError || '');
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateEmail(email);
    if (validationError) {
      setError(validationError);
      return;
    }

    // Submit form...
  };

  return (
    <form onSubmit={handleSubmit}>
      <div>
        <label htmlFor="email">Email</label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={handleChange}
          onBlur={handleBlur}
          aria-invalid={!!error}
          aria-describedby={error ? "email-error" : undefined}
        />
        {error && (
          <div id="email-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <button type="submit">Sign Up</button>
    </form>
  );
}
```

**Self-review:**

- ✓ Validates on blur
- ✓ Shows errors while typing (after touched)
- ✓ Helpful error messages
- ✓ Accessible with aria attributes
- ❌ Visual feedback? **No success state**
- ❌ Matches design system? **Need to check**

**Decision:** Check existing components for patterns

---

### Iteration 3 (Match Design System)

**Check existing components:**

```bash
$ grep -r "className.*input" src/components/ui/
src/components/ui/Input.tsx: className="border rounded px-3 py-2"
src/components/ui/Input.tsx: className="border-red-500"  // error state
src/components/ui/Input.tsx: className="border-green-500" // success state
```

**Insight:** Project has reusable Input component with standard styles.

**Refactored implementation:**

```typescript
import { Input } from '@/components/ui/Input';

export function SignupForm() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const validateEmail = (email: string): string | null => {
    if (!email) return 'Email is required';
    if (email.length < 3) return 'Email is too short';
    if (!email.includes('@')) return 'Email must contain @';

    const regex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return regex.test(email) ? null : 'Please enter a valid email address';
  };

  const handleBlur = () => {
    setTouched(true);
    setError(validateEmail(email));
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newEmail = e.target.value;
    setEmail(newEmail);

    if (touched) {
      setError(validateEmail(newEmail));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const validationError = validateEmail(email);
    if (validationError) {
      setError(validationError);
      return;
    }

    // Submit form...
  };

  // Determine validation state
  const validationState = touched
    ? error
      ? 'error'
      : email
      ? 'success'
      : undefined
    : undefined;

  return (
    <form onSubmit={handleSubmit}>
      <Input
        id="email"
        label="Email"
        type="email"
        value={email}
        onChange={handleChange}
        onBlur={handleBlur}
        error={error}
        validationState={validationState}
      />
      <button type="submit">Sign Up</button>
    </form>
  );
}
```

**Self-review:**

- ✓ Uses design system Input component
- ✓ Consistent with other forms
- ✓ Shows success state when valid
- ✓ Accessible (Input handles aria)
- ✓ Clean, readable code

**Decision:** Ready for tests

---

### Iteration 4 (Add Tests)

```typescript
// src/components/__tests__/SignupForm.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { SignupForm } from '../SignupForm';

describe('SignupForm email validation', () => {
  it('should show error on invalid email after blur', () => {
    render(<SignupForm />);

    const input = screen.getByLabelText('Email');

    fireEvent.change(input, { target: { value: 'invalid' } });
    fireEvent.blur(input);

    expect(screen.getByRole('alert')).toHaveTextContent('Email must contain @');
  });

  it('should show success state for valid email', () => {
    render(<SignupForm />);

    const input = screen.getByLabelText('Email');

    fireEvent.change(input, { target: { value: 'user@example.com' } });
    fireEvent.blur(input);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(input).toHaveClass('border-green-500'); // Success state
  });

  it('should validate while typing after first blur', () => {
    render(<SignupForm />);

    const input = screen.getByLabelText('Email');

    // Initial blur with invalid email
    fireEvent.change(input, { target: { value: 'invalid' } });
    fireEvent.blur(input);

    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Should validate while typing now
    fireEvent.change(input, { target: { value: 'invalid@' } });
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.change(input, { target: { value: 'user@example.com' } });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
```

**Run tests:**

```bash
$ pnpm test SignupForm
PASS  src/components/__tests__/SignupForm.test.tsx

Tests: 3 passed, 3 total
```

**Commit:**

```bash
$ git add src/components/SignupForm.tsx src/components/__tests__/SignupForm.test.tsx
$ git commit -m "feat(signup): add email validation with progressive feedback

- Validate on blur for first-time
- Validate while typing after initial blur
- Clear error messages for each validation failure
- Success state when email is valid
- Use design system Input component"
```

---

### Summary of Refinement

**Iterations:**

1. Basic validation → Improved UX with better timing
2. Better UX → Matched design system patterns
3. Design system → Added comprehensive tests
4. Tests passing → Committed

**Improvements made through self-review:**

- Validation timing (submit-only → blur → live)
- Error messages (vague → specific)
- Accessibility (none → full aria support)
- Design consistency (custom → design system)
- Visual feedback (error-only → success + error)

---

## Key Principles of Iterative Refinement

### 1. Self-Review Checkpoints

After each change, ask:

- Does it compile/build?
- Does it follow existing patterns?
- Are edge cases handled?
- Is it simple enough?
- Is it accessible?
- Is it testable?

### 2. Iterate Before Committing

Don't commit first draft. Refine until code passes self-review.

### 3. Tests Reveal Issues

Tests often uncover edge cases missed in implementation. That's expected—iterate and fix.

### 4. Match Existing Patterns

Check how similar features are implemented. Consistency > cleverness.

### 5. Progressive Enhancement

Start simple, add sophistication through iteration:

1. Make it work
2. Make it right (refine logic)
3. Make it match patterns (consistency)
4. Make it tested (validation)

### 6. No Arbitrary Limits

Keep iterating until code is clean. If something feels wrong, it probably is—refine it.

---

## Comparison: Without vs With Iterative Refinement

### Without Refinement (First Draft → Commit)

```
Time saved: ~15 minutes (no iterations)

Problems:
- Edge cases discovered in production
- Inconsistent with existing code
- Poor UX discovered by users
- Accessibility issues found in audit
- Tests added later, reveal bugs

Total cost: High (rework, bugs, user frustration)
```

### With Refinement (Iterate → Test → Commit)

```
Time invested: +30 minutes (iterations + self-review)

Benefits:
- Edge cases caught early
- Consistent with codebase
- Good UX from day one
- Accessible from the start
- Tests validate correctness

Total cost: Low (clean code, no rework, happy users)
```

---

## When to Stop Iterating

**Stop when:**

- ✅ Self-review checklist passes
- ✅ Tests pass
- ✅ Code matches project patterns
- ✅ Edge cases handled
- ✅ No obvious improvements

**Don't stop because:**

- ❌ "It's good enough" (it's not if you have doubts)
- ❌ "I've tried 3 times" (no arbitrary limits)
- ❌ "Tests are too hard to write" (refactor to make testable)

**Exception - stop and ask user if:**

- Fundamental approach is wrong
- Requirements were misunderstood
- External blocker encountered

---

## Conclusion

Iterative refinement is the core of autonomous quality. By validating and improving at each step, we deliver production-ready code on the first PR, not the third revision.

**Remember:** Fast iteration during development > slow fixes after deployment.
