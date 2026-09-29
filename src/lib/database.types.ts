export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      body_profile: {
        Row: {
          birth_date: string | null
          goal: string
          height_cm: number | null
          sex: string | null
          target_weight_kg: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          birth_date?: string | null
          goal?: string
          height_cm?: number | null
          sex?: string | null
          target_weight_kg?: number | null
          updated_at?: string
          user_id?: string
        }
        Update: {
          birth_date?: string | null
          goal?: string
          height_cm?: number | null
          sex?: string | null
          target_weight_kg?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      exercises: {
        Row: {
          category: string
          equipment: string | null
          force: string | null
          id: string
          images: string[]
          instructions: string[]
          level: string
          mechanic: string | null
          name: string
          primary_muscles: string[]
          secondary_muscles: string[]
        }
        Insert: {
          category: string
          equipment?: string | null
          force?: string | null
          id: string
          images?: string[]
          instructions?: string[]
          level: string
          mechanic?: string | null
          name: string
          primary_muscles?: string[]
          secondary_muscles?: string[]
        }
        Update: {
          category?: string
          equipment?: string | null
          force?: string | null
          id?: string
          images?: string[]
          instructions?: string[]
          level?: string
          mechanic?: string | null
          name?: string
          primary_muscles?: string[]
          secondary_muscles?: string[]
        }
        Relationships: []
      }
      routine_days: {
        Row: {
          id: string
          label: string
          routine_id: string
          user_id: string
          weekday: number
        }
        Insert: {
          id?: string
          label: string
          routine_id: string
          user_id?: string
          weekday: number
        }
        Update: {
          id?: string
          label?: string
          routine_id?: string
          user_id?: string
          weekday?: number
        }
        Relationships: [
          {
            foreignKeyName: "routine_days_routine_fk"
            columns: ["routine_id", "user_id"]
            isOneToOne: false
            referencedRelation: "routines"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      routine_exercises: {
        Row: {
          exercise_id: string
          id: string
          notes: string | null
          position: number
          routine_day_id: string
          target_reps: string | null
          target_sets: number | null
          user_id: string
        }
        Insert: {
          exercise_id: string
          id?: string
          notes?: string | null
          position?: number
          routine_day_id: string
          target_reps?: string | null
          target_sets?: number | null
          user_id?: string
        }
        Update: {
          exercise_id?: string
          id?: string
          notes?: string | null
          position?: number
          routine_day_id?: string
          target_reps?: string | null
          target_sets?: number | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "routine_exercises_day_fk"
            columns: ["routine_day_id", "user_id"]
            isOneToOne: false
            referencedRelation: "routine_days"
            referencedColumns: ["id", "user_id"]
          },
          {
            foreignKeyName: "routine_exercises_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
        ]
      }
      routines: {
        Row: {
          created_at: string
          id: string
          is_active: boolean
          name: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_active?: boolean
          name: string
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          is_active?: boolean
          name?: string
          user_id?: string
        }
        Relationships: []
      }
      session_sets: {
        Row: {
          exercise_id: string
          id: string
          reps: number | null
          session_id: string
          set_index: number
          user_id: string
          weight_kg: number | null
        }
        Insert: {
          exercise_id: string
          id?: string
          reps?: number | null
          session_id: string
          set_index: number
          user_id?: string
          weight_kg?: number | null
        }
        Update: {
          exercise_id?: string
          id?: string
          reps?: number | null
          session_id?: string
          set_index?: number
          user_id?: string
          weight_kg?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "session_sets_exercise_id_fkey"
            columns: ["exercise_id"]
            isOneToOne: false
            referencedRelation: "exercises"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "session_sets_session_fk"
            columns: ["session_id", "user_id"]
            isOneToOne: false
            referencedRelation: "sessions"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      sessions: {
        Row: {
          created_at: string
          id: string
          notes: string | null
          performed_on: string
          routine_day_id: string | null
          set_count: number
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          notes?: string | null
          performed_on?: string
          routine_day_id?: string | null
          set_count?: number
          user_id?: string
        }
        Update: {
          created_at?: string
          id?: string
          notes?: string | null
          performed_on?: string
          routine_day_id?: string | null
          set_count?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "sessions_routine_day_owner_fk"
            columns: ["routine_day_id", "user_id"]
            isOneToOne: false
            referencedRelation: "routine_days"
            referencedColumns: ["id", "user_id"]
          },
        ]
      }
      weight_entries: {
        Row: {
          id: string
          measured_on: string
          user_id: string
          weight_kg: number
        }
        Insert: {
          id?: string
          measured_on?: string
          user_id?: string
          weight_kg: number
        }
        Update: {
          id?: string
          measured_on?: string
          user_id?: string
          weight_kg?: number
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      activate_routine: {
        Args: { p_routine_id: string }
        Returns: undefined
      }
      swap_routine_exercise_positions: {
        Args: {
          p_a_id: string
          p_a_position: number
          p_b_id: string
          p_b_position: number
        }
        Returns: undefined
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
