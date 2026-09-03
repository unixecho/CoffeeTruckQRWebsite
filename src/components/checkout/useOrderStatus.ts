"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { fetchOrder, type OrderStatusResponse } from "./api";
import type { PublicOrderView } from "@/lib/payments/types";

/* ==========================================================================
   Watching an order

   The order screen has to update without the customer doing anything: a card
   payment settles from a webhook, and the owner marks an order collected from
   a different phone entirely. So it polls.

   ## Why polling, and not something cleverer

   A websocket or a Supabase realtime subscription would be fewer requests and
   considerably more moving parts: a second authenticated channel, a second
   thing to fall over on a market-stand tether, and a second place the order's
   read authorisation would have to be enforced. The read is one indexed
   lookup behind a token, the window is minutes not hours, and there is
   exactly one screen doing it. Polling is the right size.

   ## The three things that keep it cheap

   1. **It stops.** Once the order reaches a state nothing else can change —
      collected, cancelled, expired — the timer is not rescheduled.
   2. **It backs off by what it is waiting for.** A card payment in flight is
      seconds away, so three. An order waiting for somebody to reach the front
      of a queue is minutes away, so fifteen.
   3. **It sleeps with the screen.** A phone in a pocket polls nothing, and
      resumes with an immediate read the moment it comes back — which is also
      what makes the screen correct by the time the customer has looked at it.

   `confirm` is separate and deliberate: it makes the server ask the provider
   what really happened rather than reporting what it already believes. Called
   once, when the payment frame says the customer is done. A redirect is a
   prompt to check, never the evidence.
   ========================================================================== */

/** A payment is in flight; the answer is seconds away. */
const FAST_INTERVAL_MS = 3_000;
/** Waiting on a person. Minutes away, and there is a battery to think about. */
const SLOW_INTERVAL_MS = 15_000;

export interface OrderStatusState {
  order: PublicOrderView;
  can: { retryPayment: boolean; cancel: boolean };
  /** True while a read is in flight, for a quiet inline indicator. */
  refreshing: boolean;
  /** Read now. Resolves to the new state, or null if the read failed. */
  refresh: (confirm?: boolean) => Promise<OrderStatusResponse | null>;
  /** Apply a response the caller already has, e.g. from a cancel. */
  apply: (next: OrderStatusResponse) => void;
}

function isSettling(order: PublicOrderView): boolean {
  return order.paymentStatus === "pending";
}

function isFinished(order: PublicOrderView): boolean {
  return order.status !== "placed";
}

export function useOrderStatus(
  token: string,
  initialOrder: PublicOrderView,
  initialCan: { retryPayment: boolean; cancel: boolean }
): OrderStatusState {
  const [order, setOrder] = useState(initialOrder);
  const [can, setCan] = useState(initialCan);
  const [refreshing, setRefreshing] = useState(false);

  /* The timer is a ref rather than state so rescheduling never causes a
     render — a poll that re-renders the tree to schedule the next poll is a
     poll that fights the payment frame's own lifecycle. */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  const apply = useCallback((next: OrderStatusResponse) => {
    setOrder(next.order);
    setCan(next.can);
  }, []);

  const refresh = useCallback(
    async (confirm = false): Promise<OrderStatusResponse | null> => {
      // One at a time. A slow read plus a visibility change would otherwise
      // stack two, and the older one could land last and overwrite the newer.
      if (inFlight.current) return null;
      inFlight.current = true;
      setRefreshing(true);

      const result = await fetchOrder(token, confirm);

      inFlight.current = false;
      setRefreshing(false);

      if (!result.ok) return null;
      apply(result.data);
      return result.data;
    },
    [token, apply]
  );

  useEffect(() => {
    if (isFinished(order)) return;

    function schedule() {
      const delay = isSettling(order) ? FAST_INTERVAL_MS : SLOW_INTERVAL_MS;
      timer.current = setTimeout(async () => {
        if (typeof document !== "undefined" && document.hidden) {
          // Asleep. Reschedule without spending a request; the visibility
          // handler below reads immediately when the screen comes back.
          schedule();
          return;
        }
        await refresh();
        schedule();
      }, delay);
    }

    function onVisibility() {
      if (document.hidden) return;
      void refresh();
    }

    schedule();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [order, refresh]);

  return { order, can, refreshing, refresh, apply };
}
