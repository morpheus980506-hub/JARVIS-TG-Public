import { createContext,useContext } from 'react'
import { useTripStore } from './trip'

export const TripScope=createContext<typeof useTripStore | undefined>(undefined)
export function useScopedTripStore() {return useContext(TripScope) ?? useTripStore}
