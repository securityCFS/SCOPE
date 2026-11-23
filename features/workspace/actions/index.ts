import * as accounts from "./account-actions";
import * as composer from "./composer-actions";
import * as history from "./history-actions";
import * as humanRequests from "./human-request-actions";
import * as models from "./model-actions";
import * as navigation from "./navigation-actions";
import * as sessions from "./session-actions";
import * as workspace from "./workspace-actions";

const operations = {
  ...models,
  ...accounts,
  ...composer,
  ...history,
  ...humanRequests,
  ...navigation,
  ...sessions,
  ...workspace,
};
type Operations = typeof operations;
type ContextUnion = Parameters<Operations[keyof Operations]>[0];
type Intersection<U> = (
  U extends unknown ? (value: U) => void : never
) extends (value: infer I) => void
  ? I
  : never;
export type WorkspaceActionContext = Intersection<ContextUnion>;
export type WorkspaceActions = {
  [K in keyof Operations]: Operations[K] extends (
    context: never,
    ...args: infer A
  ) => infer R
    ? (...args: A) => R
    : never;
};

/** Resolve dependencies when an action is invoked, after the current render has
 * assembled its state. This also allows actions to call other typed actions
 * without threading every setter through the route and every component. */
export function bindWorkspaceActions(
  context: () => WorkspaceActionContext,
): WorkspaceActions {
  return Object.fromEntries(
    Object.entries(operations).map(([name, operation]) => [
      name,
      (...args: unknown[]) =>
        Reflect.apply(operation, undefined, [context(), ...args]),
    ]),
  ) as WorkspaceActions;
}
