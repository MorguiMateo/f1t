import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { guardAuthMutation, runIfAuthQueryClientActive } from '../auth/auth-query-client'
import { deleteFood, fetchFoodDay, logFood, setFoodQuantity, type FoodEntry } from './api'

export const foodKeys = {
  all: ['foods'] as const,
  day: (date: string) => ['foods', 'day', date] as const,
}

export function useFoodDay(date: string) {
  return useQuery({ queryKey: foodKeys.day(date), queryFn: () => fetchFoodDay(date) })
}

export async function invalidateFoodDay(client: QueryClient, date: string): Promise<void> {
  await client.invalidateQueries({ queryKey: foodKeys.day(date) })
}

export function useLogFood() {
  const client = useQueryClient()
  return useMutation<FoodEntry, Error, Parameters<typeof logFood>[0]>({
    mutationFn: guardAuthMutation(client, logFood),
    onSuccess: (_row, input) => runIfAuthQueryClientActive(client, () => invalidateFoodDay(client, input.date)),
  })
}

export function useSetFoodQuantity() {
  const client = useQueryClient()
  return useMutation<FoodEntry, Error, { id: string; quantity: number; date: string }>({
    mutationFn: guardAuthMutation(client, (input: { id: string; quantity: number; date: string }) => setFoodQuantity(input)),
    onSuccess: (_row, input) => runIfAuthQueryClientActive(client, () => invalidateFoodDay(client, input.date)),
  })
}

export function useDeleteFood() {
  const client = useQueryClient()
  return useMutation<void, Error, { id: string; date: string }>({
    mutationFn: guardAuthMutation(client, (input: { id: string; date: string }) => deleteFood(input.id)),
    onSuccess: (_row, input) => runIfAuthQueryClientActive(client, () => invalidateFoodDay(client, input.date)),
  })
}
