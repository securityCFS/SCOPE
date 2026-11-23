export function apply(ctx) {
  ctx.action("hello", () => ({ message: ctx.config.greeting }));
  // Use ctx.onDispose(() => clearInterval(timer)) for timers or subscriptions.
}
