export type InitialShareOrigin = "history" | "default";

export type ShareOrigin = InitialShareOrigin | "user";

export function originOrDefault(origin: ShareOrigin | undefined): ShareOrigin {
  return origin ?? "default";
}

export function showsHistoryBadge(origin: ShareOrigin): boolean {
  return origin === "history";
}

export function originAfterShareEdit(_origin: ShareOrigin): "user" {
  return "user";
}

export function originAfterNameEdit(origin: ShareOrigin): ShareOrigin {
  if (origin === "history") {
    return "default";
  }
  return origin;
}

export function originFromMatched(matched: boolean): InitialShareOrigin {
  return matched ? "history" : "default";
}
