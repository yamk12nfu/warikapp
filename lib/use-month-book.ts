"use client";

import { api } from "@/convex/_generated/api";
import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import {
  nextBookMonth,
  shiftYearMonth,
  trailingYearMonths,
  type MonthWindow,
  type YearMonth,
} from "./month-book";

type MonthQueryResult = FunctionReturnType<typeof api.monthBook.month>;

export type MonthSlice = Extract<MonthQueryResult, { kind: "exact" }>["slice"];

export type MonthPoint =
  | { kind: "loading" }
  | { kind: "overflow"; limit: number }
  | { kind: "exact"; slice: MonthSlice };

export type MonthPointWindow = readonly [
  MonthPoint,
  MonthPoint,
  MonthPoint,
  MonthPoint,
  MonthPoint,
  MonthPoint,
];

export type MonthBookView = {
  months: MonthWindow;
  points: MonthPointWindow;
  focus: MonthPoint;
  prevMonth: YearMonth;
  nextMonth: YearMonth | null;
};

export function toMonthPoint(result: MonthQueryResult | undefined): MonthPoint {
  if (result === undefined) {
    return { kind: "loading" };
  }
  if (result.kind === "overflow") {
    return { kind: "overflow", limit: result.limit };
  }
  return { kind: "exact", slice: result.slice };
}

export function useMonthBook(
  anchor: YearMonth,
  todayMonth: YearMonth,
  enabled: boolean,
): MonthBookView {
  const months = trailingYearMonths(anchor);
  // 1本の range にすると 16MiB を超えうる。useQueries はこの版では skip できない。
  const slot0 = useQuery(
    api.monthBook.month,
    enabled ? { month: months[0] } : "skip",
  );
  const slot1 = useQuery(
    api.monthBook.month,
    enabled ? { month: months[1] } : "skip",
  );
  const slot2 = useQuery(
    api.monthBook.month,
    enabled ? { month: months[2] } : "skip",
  );
  const slot3 = useQuery(
    api.monthBook.month,
    enabled ? { month: months[3] } : "skip",
  );
  const slot4 = useQuery(
    api.monthBook.month,
    enabled ? { month: months[4] } : "skip",
  );
  const slot5 = useQuery(
    api.monthBook.month,
    enabled ? { month: months[5] } : "skip",
  );
  const points: MonthPointWindow = [
    toMonthPoint(slot0),
    toMonthPoint(slot1),
    toMonthPoint(slot2),
    toMonthPoint(slot3),
    toMonthPoint(slot4),
    toMonthPoint(slot5),
  ];
  const focus = points[5];
  return {
    months,
    points,
    focus,
    prevMonth: shiftYearMonth(anchor, -1),
    nextMonth: nextBookMonth(anchor, todayMonth),
  };
}
