import { createContext, useContext, useMemo, useReducer, type Dispatch, type ReactNode } from "react";
import type { PredictResponse } from "../api/endpoints";
import type { NormalisedError } from "../api/client";
import type { LatLng, PinStatus } from "../maps/types";

export interface Pin extends LatLng {
  name?: string;
}

export interface LocationState {
  status: PinStatus;
  nearest_km: number | null;
  message: string | null;
  checking: boolean;
}

export type Result = PredictResponse | "needs-fixing" | null;

export interface AssessState {
  values: Record<string, string>;
  vehicles: string[];
  errors: Record<string, string>;
  locationErrors: string[];
  pin: Pin | null;
  location: LocationState | null;
  locationMode: "map" | "coordinates";
  latText: string;
  lngText: string;
  result: Result;
  submitting: boolean;
  submitError: NormalisedError | null;
}

export const initialAssessState: AssessState = {
  values: {},
  vehicles: [],
  errors: {},
  locationErrors: [],
  pin: null,
  location: null,
  locationMode: "map",
  latText: "",
  lngText: "",
  result: null,
  submitting: false,
  submitError: null,
};

export type AssessAction =
  | { type: "setValue"; name: string; value: string }
  | { type: "setVehicles"; vehicles: string[] }
  | { type: "setErrors"; errors: Record<string, string>; locationErrors: string[] }
  | { type: "setPin"; pin: Pin | null }
  | { type: "setLocation"; location: LocationState | null }
  | { type: "setMode"; mode: "map" | "coordinates" }
  | { type: "setCoordinateText"; latText?: string; lngText?: string }
  | { type: "setResult"; result: Result }
  | { type: "setSubmitting"; submitting: boolean }
  | { type: "setSubmitError"; error: NormalisedError | null }
  | { type: "clearForm" };

export function assessReducer(state: AssessState, action: AssessAction): AssessState {
  switch (action.type) {
    case "setValue": {
      // Editing a field clears its own error only.
      const errors = Object.fromEntries(Object.entries(state.errors).filter(([key]) => key !== action.name));
      return { ...state, values: { ...state.values, [action.name]: action.value }, errors };
    }
    case "setVehicles": {
      const errors = { ...state.errors };
      delete errors["vehicles"];
      return { ...state, vehicles: action.vehicles, errors };
    }
    case "setErrors":
      return { ...state, errors: action.errors, locationErrors: action.locationErrors };
    case "setPin":
      return { ...state, pin: action.pin, location: action.pin ? state.location : null };
    case "setLocation":
      return { ...state, location: action.location };
    case "setMode":
      return { ...state, locationMode: action.mode };
    case "setCoordinateText":
      return {
        ...state,
        latText: action.latText ?? state.latText,
        lngText: action.lngText ?? state.lngText,
      };
    case "setResult":
      return { ...state, result: action.result };
    case "setSubmitting":
      return { ...state, submitting: action.submitting };
    case "setSubmitError":
      return { ...state, submitError: action.error };
    case "clearForm":
      return initialAssessState;
  }
}

interface AssessContextValue {
  state: AssessState;
  dispatch: Dispatch<AssessAction>;
}

const AssessContext = createContext<AssessContextValue | null>(null);

// Lives above the routes, so the form, pin and result survive a trip to About and back.
export function AssessProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(assessReducer, initialAssessState);
  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <AssessContext.Provider value={value}>{children}</AssessContext.Provider>;
}

export function useAssess(): AssessContextValue {
  const value = useContext(AssessContext);
  if (!value) throw new Error("useAssess must be used inside AssessProvider");
  return value;
}
