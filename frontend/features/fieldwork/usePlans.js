import { useEffect, useState } from 'react';
import { fieldworkPlan } from '@/api/endpoints';

/** Plany z /api/fieldwork dla listy zapytań (jedno pole albo wszystkie), pobierane równolegle: zapytanie → odpowiedź. */
export function usePlans(queries) {
  const key = [...new Set(queries.filter(Boolean))].join('|');
  const [plans, setPlans] = useState({});
  useEffect(() => {
    const controller = new AbortController();
    for (const query of key ? key.split('|') : []) {
      fieldworkPlan(query, controller.signal)
        .then((data) => setPlans((state) => ({ ...state, [query]: data })))
        .catch((error) => {
          if (!controller.signal.aborted) setPlans((state) => ({ ...state, [query]: { status: 'error', reason: error.message } }));
        });
    }
    return () => controller.abort();
  }, [key]);
  return plans;
}
