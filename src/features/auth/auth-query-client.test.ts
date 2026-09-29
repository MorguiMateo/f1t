import { describe, expect, it, vi } from "vitest";
import {
  createAuthQueryClient,
  disposeAuthQueryClient,
  guardAuthMutation,
  runIfAuthQueryClientActive,
  setAuthQueryIdentity,
} from "./auth-query-client";

describe("auth query clients", () => {
  it("keeps an old account's cached and in-flight data out of the next client", async () => {
    const oldClient = createAuthQueryClient();
    const nextClient = createAuthQueryClient();
    oldClient.setQueryData(["body", "profile"], { userId: "old" });

    let finish!: (value: { userId: string }) => void;
    const request = oldClient.fetchQuery({
      queryKey: ["routines", "list"],
      queryFn: () => new Promise<{ userId: string }>((resolve) => { finish = resolve; }),
    });

    disposeAuthQueryClient(oldClient);
    finish({ userId: "old" });
    await request.catch(() => undefined);

    expect(nextClient.getQueryData(["body", "profile"])).toBeUndefined();
    expect(nextClient.getQueryData(["routines", "list"])).toBeUndefined();
    expect(oldClient.getQueryData(["body", "profile"])).toBeUndefined();
    disposeAuthQueryClient(nextClient);
  });

  it("rejects a scoped mutation that starts after an identity switch and ignores late callbacks", async () => {
    setAuthQueryIdentity("account-a");
    const oldClient = createAuthQueryClient();
    let finishFirst!: (value: string) => void;
    const writes: string[] = [];

    const guarded = guardAuthMutation(oldClient, async (value: string) => {
      writes.push(value);
      if (value === "first") {
        return new Promise<string>((resolve) => { finishFirst = resolve; });
      }
      return value;
    });
    const options = {
      scope: { id: "serial-profile-write" },
      retry: 0,
      mutationFn: guarded,
      onSuccess: (value: string) =>
        runIfAuthQueryClientActive(oldClient, () => {
          oldClient.setQueryData(["profile"], value);
        }),
    };
    const first = oldClient.getMutationCache().build(oldClient, options);
    const second = oldClient.getMutationCache().build(oldClient, options);
    const firstResult = first.execute("first");
    const secondResult = second.execute("second");
    const secondChecked = expect(secondResult).rejects.toThrow("La sesión cambió");
    await vi.waitFor(() => expect(writes).toEqual(["first"]));

    setAuthQueryIdentity("account-b");
    const nextClient = createAuthQueryClient();
    disposeAuthQueryClient(oldClient);
    finishFirst("old result");
    await firstResult;
    await secondChecked;

    expect(writes).toEqual(["first"]);
    expect(oldClient.getQueryData(["profile"])).toBeUndefined();
    expect(nextClient.getQueryData(["profile"])).toBeUndefined();
    disposeAuthQueryClient(nextClient);
    setAuthQueryIdentity(null);
  });

  it("does not retire the current identity on a StrictMode cleanup replay", async () => {
    setAuthQueryIdentity("strict-mode-user");
    const client = createAuthQueryClient();
    disposeAuthQueryClient(client);

    const write = guardAuthMutation(client, async (value: string) => value);
    await expect(write("still current")).resolves.toBe("still current");
    setAuthQueryIdentity(null);
  });
});
