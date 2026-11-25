# Why the smallest-change rule exists

A capable model writes more code than the task needs: options nobody set, wrappers with one caller, a new helper beside an existing one.
Every extra line is read, tested, and fixed later, and review-time checks such as `fit --inventory` catch it only after the code exists, when removing it costs a second pass.
The ladder moves the same question to the moment before the code is written.

The ladder and reach-before-write come from the [Ponytail](https://github.com/DietrichGebert/ponytail) skill.
Its benchmark (the same agent with and without the prompt, 39 tasks, five runs each) reports about half the code and a higher share of risky logic shipped with a test.
Those are the author's own measurements, not reproduced here.

Two parts of it matter more than the ladder itself:

1. **Reach before write.** The shortest diff is only correct once you know every place it must touch.
   A fix applied in the caller that showed the symptom, while the shared function stays broken, is the most common way a small diff is also an incomplete one.
2. **Never cut.** A size rule with no floor deletes validation and error handling first, because they are the lines that look optional.
   The floor is stated as a list so it cannot be argued away case by case.

The rule sits beside `corrections.md` rather than inside it: corrections record failures observed on this workflow's own runs, and this rule is an adopted practice.
