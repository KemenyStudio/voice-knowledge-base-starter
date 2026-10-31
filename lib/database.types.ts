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
    PostgrestVersion: "12.2.3 (519615d)"
  }
  public: {
    Tables: {
      answer_ratings: {
        Row: {
          comment: string | null
          created_at: string
          message_id: string
          rating: number
          user_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          message_id: string
          rating: number
          user_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          message_id?: string
          rating?: number
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "answer_ratings_message_id_fkey"
            columns: ["message_id"]
            isOneToOne: false
            referencedRelation: "chat_messages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "answer_ratings_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          chatbot_id: string
          citations: Json
          content: string
          created_at: string
          id: string
          role: string
          session_id: string
          title: string | null
          user_id: string
        }
        Insert: {
          chatbot_id: string
          citations?: Json
          content: string
          created_at?: string
          id: string
          role: string
          session_id: string
          title?: string | null
          user_id: string
        }
        Update: {
          chatbot_id?: string
          citations?: Json
          content?: string
          created_at?: string
          id?: string
          role?: string
          session_id?: string
          title?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_chatbot_id_fkey"
            columns: ["chatbot_id"]
            isOneToOne: false
            referencedRelation: "chatbots"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      chatbots: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          system_prompt: string | null
          team_id: string | null
          vector_store_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          system_prompt?: string | null
          team_id?: string | null
          vector_store_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          system_prompt?: string | null
          team_id?: string | null
          vector_store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chatbots_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      evaluation_results: {
        Row: {
          data: string | null
          evaluation_set: string
          timestamp: string | null
        }
        Insert: {
          data?: string | null
          evaluation_set: string
          timestamp?: string | null
        }
        Update: {
          data?: string | null
          evaluation_set?: string
          timestamp?: string | null
        }
        Relationships: []
      }
      feedback: {
        Row: {
          chatbot_id: string | null
          created_by: string | null
          evaluation_set: string
          is_positive: boolean | null
          question_id: string
          timestamp: string | null
        }
        Insert: {
          chatbot_id?: string | null
          created_by?: string | null
          evaluation_set: string
          is_positive?: boolean | null
          question_id: string
          timestamp?: string | null
        }
        Update: {
          chatbot_id?: string | null
          created_by?: string | null
          evaluation_set?: string
          is_positive?: boolean | null
          question_id?: string
          timestamp?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "feedback_chatbot_id_fkey"
            columns: ["chatbot_id"]
            isOneToOne: false
            referencedRelation: "chatbots"
            referencedColumns: ["id"]
          },
        ]
      }
      feedback_summary: {
        Row: {
          evaluation_set: string
          negative: number | null
          positive: number | null
        }
        Insert: {
          evaluation_set: string
          negative?: number | null
          positive?: number | null
        }
        Update: {
          evaluation_set?: string
          negative?: number | null
          positive?: number | null
        }
        Relationships: []
      }
      files: {
        Row: {
          blob_name: string | null
          chatbot_id: string | null
          file_name: string
          file_type: string | null
          file_url: string
          id: string
          metadata: Json | null
          openai_file_id: string | null
          size_bytes: number | null
          sync_error: string | null
          sync_status: string
          uploaded_at: string | null
          uploaded_by: string | null
          vector_store_id: string | null
        }
        Insert: {
          blob_name?: string | null
          chatbot_id?: string | null
          file_name: string
          file_type?: string | null
          file_url: string
          id?: string
          metadata?: Json | null
          openai_file_id?: string | null
          size_bytes?: number | null
          sync_error?: string | null
          sync_status?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
          vector_store_id?: string | null
        }
        Update: {
          blob_name?: string | null
          chatbot_id?: string | null
          file_name?: string
          file_type?: string | null
          file_url?: string
          id?: string
          metadata?: Json | null
          openai_file_id?: string | null
          size_bytes?: number | null
          sync_error?: string | null
          sync_status?: string
          uploaded_at?: string | null
          uploaded_by?: string | null
          vector_store_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "files_chatbot_id_fkey"
            columns: ["chatbot_id"]
            isOneToOne: false
            referencedRelation: "chatbots"
            referencedColumns: ["id"]
          },
        ]
      }
      invitations: {
        Row: {
          created_at: string
          email: string
          expires_at: string
          id: string
          role: string
          team_id: string | null
        }
        Insert: {
          created_at?: string
          email: string
          expires_at?: string
          id: string
          role?: string
          team_id?: string | null
        }
        Update: {
          created_at?: string
          email?: string
          expires_at?: string
          id?: string
          role?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "invitations_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_sections: {
        Row: {
          content: string | null
          created_at: string | null
          id: string
          manual_id: string
          metadata: Json | null
          section_order: number
          title: string
          updated_at: string | null
        }
        Insert: {
          content?: string | null
          created_at?: string | null
          id?: string
          manual_id: string
          metadata?: Json | null
          section_order?: number
          title: string
          updated_at?: string | null
        }
        Update: {
          content?: string | null
          created_at?: string | null
          id?: string
          manual_id?: string
          metadata?: Json | null
          section_order?: number
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manual_sections_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "manuals"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_version_sections: {
        Row: {
          content: string | null
          id: string
          metadata: Json | null
          section_order: number
          title: string
          version_id: string
        }
        Insert: {
          content?: string | null
          id?: string
          metadata?: Json | null
          section_order?: number
          title: string
          version_id: string
        }
        Update: {
          content?: string | null
          id?: string
          metadata?: Json | null
          section_order?: number
          title?: string
          version_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "manual_version_sections_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "manual_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      manual_versions: {
        Row: {
          change_summary: string | null
          created_at: string | null
          created_by: string
          description: string | null
          id: string
          manual_id: string
          metadata: Json | null
          title: string
          version_number: number
        }
        Insert: {
          change_summary?: string | null
          created_at?: string | null
          created_by: string
          description?: string | null
          id?: string
          manual_id: string
          metadata?: Json | null
          title: string
          version_number: number
        }
        Update: {
          change_summary?: string | null
          created_at?: string | null
          created_by?: string
          description?: string | null
          id?: string
          manual_id?: string
          metadata?: Json | null
          title?: string
          version_number?: number
        }
        Relationships: [
          {
            foreignKeyName: "manual_versions_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manual_versions_manual_id_fkey"
            columns: ["manual_id"]
            isOneToOne: false
            referencedRelation: "manuals"
            referencedColumns: ["id"]
          },
        ]
      }
      manuals: {
        Row: {
          created_at: string | null
          created_by: string
          current_version: number | null
          description: string | null
          id: string
          metadata: Json | null
          organization_id: string | null
          status: string
          title: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          current_version?: number | null
          description?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          status?: string
          title: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          current_version?: number | null
          description?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string | null
          status?: string
          title?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "manuals_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "manuals_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_glossary_terms: {
        Row: {
          category: string | null
          created_at: string | null
          created_by: string
          definition: string
          id: string
          metadata: Json | null
          organization_id: string
          term: string
          updated_at: string | null
        }
        Insert: {
          category?: string | null
          created_at?: string | null
          created_by: string
          definition: string
          id?: string
          metadata?: Json | null
          organization_id: string
          term: string
          updated_at?: string | null
        }
        Update: {
          category?: string | null
          created_at?: string | null
          created_by?: string
          definition?: string
          id?: string
          metadata?: Json | null
          organization_id?: string
          term?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_glossary_terms_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_glossary_terms_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_policies: {
        Row: {
          approver: string | null
          attachments: Json | null
          category: string
          content: string
          created_at: string | null
          created_by: string
          description: string | null
          effective_date: string | null
          id: string
          metadata: Json | null
          organization_id: string
          owner: string
          review_date: string | null
          status: string
          tags: Json | null
          title: string
          updated_at: string | null
          version: string
        }
        Insert: {
          approver?: string | null
          attachments?: Json | null
          category: string
          content: string
          created_at?: string | null
          created_by: string
          description?: string | null
          effective_date?: string | null
          id?: string
          metadata?: Json | null
          organization_id: string
          owner: string
          review_date?: string | null
          status?: string
          tags?: Json | null
          title: string
          updated_at?: string | null
          version?: string
        }
        Update: {
          approver?: string | null
          attachments?: Json | null
          category?: string
          content?: string
          created_at?: string | null
          created_by?: string
          description?: string | null
          effective_date?: string | null
          id?: string
          metadata?: Json | null
          organization_id?: string
          owner?: string
          review_date?: string | null
          status?: string
          tags?: Json | null
          title?: string
          updated_at?: string | null
          version?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_policies_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_policies_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_products: {
        Row: {
          account_levels: Json | null
          amount: string | null
          annual_rate: string | null
          cat_gat: string | null
          client_classification_pld: Json
          client_classification_reserves: Json | null
          commercial_name: string
          commissions: Json | null
          contracting_requirements: string | null
          contracting_types: Json | null
          created_at: string | null
          created_by: string
          credit_destination: string | null
          credit_types: Json | null
          currency: string | null
          deposit_types: Json | null
          description: string | null
          guarantee_classifications: Json | null
          id: string
          is_basic_product: boolean
          metadata: Json | null
          organization_id: string
          payment_frequency: string | null
          product_type: string
          revolving_classifications: Json | null
          status: string
          term: string | null
          updated_at: string | null
          version: number
        }
        Insert: {
          account_levels?: Json | null
          amount?: string | null
          annual_rate?: string | null
          cat_gat?: string | null
          client_classification_pld?: Json
          client_classification_reserves?: Json | null
          commercial_name: string
          commissions?: Json | null
          contracting_requirements?: string | null
          contracting_types?: Json | null
          created_at?: string | null
          created_by: string
          credit_destination?: string | null
          credit_types?: Json | null
          currency?: string | null
          deposit_types?: Json | null
          description?: string | null
          guarantee_classifications?: Json | null
          id?: string
          is_basic_product?: boolean
          metadata?: Json | null
          organization_id: string
          payment_frequency?: string | null
          product_type: string
          revolving_classifications?: Json | null
          status?: string
          term?: string | null
          updated_at?: string | null
          version?: number
        }
        Update: {
          account_levels?: Json | null
          amount?: string | null
          annual_rate?: string | null
          cat_gat?: string | null
          client_classification_pld?: Json
          client_classification_reserves?: Json | null
          commercial_name?: string
          commissions?: Json | null
          contracting_requirements?: string | null
          contracting_types?: Json | null
          created_at?: string | null
          created_by?: string
          credit_destination?: string | null
          credit_types?: Json | null
          currency?: string | null
          deposit_types?: Json | null
          description?: string | null
          guarantee_classifications?: Json | null
          id?: string
          is_basic_product?: boolean
          metadata?: Json | null
          organization_id?: string
          payment_frequency?: string | null
          product_type?: string
          revolving_classifications?: Json | null
          status?: string
          term?: string | null
          updated_at?: string | null
          version?: number
        }
        Relationships: [
          {
            foreignKeyName: "organization_products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_products_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_validations: {
        Row: {
          completed_at: string | null
          created_by: string
          id: string
          ignored_issues: Json | null
          issues: Json | null
          organization_id: string
          started_at: string | null
          status: string
          summary: Json | null
        }
        Insert: {
          completed_at?: string | null
          created_by: string
          id?: string
          ignored_issues?: Json | null
          issues?: Json | null
          organization_id: string
          started_at?: string | null
          status?: string
          summary?: Json | null
        }
        Update: {
          completed_at?: string | null
          created_by?: string
          id?: string
          ignored_issues?: Json | null
          issues?: Json | null
          organization_id?: string
          started_at?: string | null
          status?: string
          summary?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_validations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_validations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizational_units: {
        Row: {
          created_at: string | null
          created_by: string
          description: string | null
          employee_count: number | null
          id: string
          level: number
          manager_name: string | null
          metadata: Json | null
          name: string
          order_index: number
          organization_id: string
          parent_id: string | null
          responsibilities: Json | null
          type: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          description?: string | null
          employee_count?: number | null
          id?: string
          level?: number
          manager_name?: string | null
          metadata?: Json | null
          name: string
          order_index?: number
          organization_id: string
          parent_id?: string | null
          responsibilities?: Json | null
          type: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          description?: string | null
          employee_count?: number | null
          id?: string
          level?: number
          manager_name?: string | null
          metadata?: Json | null
          name?: string
          order_index?: number
          organization_id?: string
          parent_id?: string | null
          responsibilities?: Json | null
          type?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizational_units_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizational_units_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organizational_units_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "organizational_units"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          created_by: string
          description: string | null
          id: string
          institution_type: string | null
          metadata: Json | null
          name: string
          razon_social: string | null
          rfc: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          created_by: string
          description?: string | null
          id?: string
          institution_type?: string | null
          metadata?: Json | null
          name: string
          razon_social?: string | null
          rfc?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string
          description?: string | null
          id?: string
          institution_type?: string | null
          metadata?: Json | null
          name?: string
          razon_social?: string | null
          rfc?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          email: string | null
          full_name: string | null
          id: string
          last_interaction: string | null
          total_messages: number | null
        }
        Insert: {
          email?: string | null
          full_name?: string | null
          id: string
          last_interaction?: string | null
          total_messages?: number | null
        }
        Update: {
          email?: string | null
          full_name?: string | null
          id?: string
          last_interaction?: string | null
          total_messages?: number | null
        }
        Relationships: []
      }
      team_members: {
        Row: {
          id: string
          joined_at: string | null
          role: string
          team_id: string | null
          user_id: string | null
        }
        Insert: {
          id?: string
          joined_at?: string | null
          role: string
          team_id?: string | null
          user_id?: string | null
        }
        Update: {
          id?: string
          joined_at?: string | null
          role?: string
          team_id?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "team_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "teams"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "team_members_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      teams: {
        Row: {
          created_at: string | null
          created_by: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      chatbot_team_id: { Args: { p_chatbot_id: string }; Returns: string }
      create_manual_version_with_current_sections: {
        Args: {
          change_summary_param?: string
          created_by_param?: string
          manual_id_param: string
        }
        Returns: {
          version_id: string
          version_number: number
        }[]
      }
      get_version_diff: {
        Args: {
          manual_id_param: string
          version_from: number
          version_to: number
        }
        Returns: {
          change_type: string
          new_content: string
          old_content: string
          section_order_from: number
          section_order_to: number
          section_title: string
        }[]
      }
      is_team_admin: {
        Args: { team_uuid: string; user_uuid: string }
        Returns: boolean
      }
      is_team_admin_self: { Args: { p_team_id: string }; Returns: boolean }
      is_team_member: { Args: { p_team_id: string }; Returns: boolean }
      list_chat_sessions: {
        Args: { p_chatbot_id: string }
        Returns: {
          last_activity: string
          last_message: string
          session_id: string
          title: string
        }[]
      }
      rename_chat_session: {
        Args: { p_chatbot_id: string; p_session_id: string; p_title: string }
        Returns: number
      }
      search_chat_sessions: {
        Args: { p_chatbot_id: string; p_query: string }
        Returns: {
          last_activity: string
          last_message: string
          session_id: string
          title: string
        }[]
      }
      restore_manual_content_only: {
        Args: { manual_id_param: string; version_number_param: number }
        Returns: {
          restored_version_number: number
          success: boolean
        }[]
      }
      restore_manual_version: {
        Args: {
          change_summary_param?: string
          manual_id_param: string
          user_id_param?: string
          version_number_param: number
        }
        Returns: {
          new_version_number: number
          success: boolean
        }[]
      }
      restore_manual_version_with_new_version: {
        Args: {
          change_summary_param?: string
          manual_id_param: string
          user_id_param?: string
          version_number_param: number
        }
        Returns: {
          new_version_number: number
          success: boolean
        }[]
      }
      update_last_sign_in: { Args: { user_id: string }; Returns: Json }
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
