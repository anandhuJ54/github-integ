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
      aggregate_ratings: {
        Row: {
          entity_id: string
          entity_type: string
          last_review_date: string | null
          rating_1: number | null
          rating_2: number | null
          rating_3: number | null
          rating_4: number | null
          rating_5: number | null
          rating_value: number | null
          review_count: number | null
          source: string
          updated_at: string | null
        }
        Insert: {
          entity_id: string
          entity_type: string
          last_review_date?: string | null
          rating_1?: number | null
          rating_2?: number | null
          rating_3?: number | null
          rating_4?: number | null
          rating_5?: number | null
          rating_value?: number | null
          review_count?: number | null
          source: string
          updated_at?: string | null
        }
        Update: {
          entity_id?: string
          entity_type?: string
          last_review_date?: string | null
          rating_1?: number | null
          rating_2?: number | null
          rating_3?: number | null
          rating_4?: number | null
          rating_5?: number | null
          rating_value?: number | null
          review_count?: number | null
          source?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      api_keys: {
        Row: {
          created_at: string | null
          expires_at: string | null
          id: string
          is_active: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at: string | null
          name: string
          org_id: string | null
          rate_limit_rpm: number | null
          scopes: string[]
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash: string
          key_prefix: string
          last_used_at?: string | null
          name: string
          org_id?: string | null
          rate_limit_rpm?: number | null
          scopes: string[]
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          expires_at?: string | null
          id?: string
          is_active?: boolean | null
          key_hash?: string
          key_prefix?: string
          last_used_at?: string | null
          name?: string
          org_id?: string | null
          rate_limit_rpm?: number | null
          scopes?: string[]
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "api_keys_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string | null
          entity_id: string | null
          entity_type: string
          field_changes: Json | null
          id: string
          impersonating: string | null
          ip_address: unknown
          request_id: string | null
          user_agent: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          created_at?: string | null
          entity_id?: string | null
          entity_type: string
          field_changes?: Json | null
          id?: string
          impersonating?: string | null
          ip_address?: unknown
          request_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string
          field_changes?: Json | null
          id?: string
          impersonating?: string | null
          ip_address?: unknown
          request_id?: string | null
          user_agent?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_impersonating_fkey"
            columns: ["impersonating"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audit_log_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      claim_queue: {
        Row: {
          claim_id: string | null
          claimant_email: string
          claimant_name: string | null
          claimant_user_id: string | null
          confidence_score: number
          confidence_signals: Json | null
          created_at: string | null
          entity_id: string
          entity_type: string
          id: string
          match_method: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          trust_tier: number | null
          updated_at: string | null
        }
        Insert: {
          claim_id?: string | null
          claimant_email: string
          claimant_name?: string | null
          claimant_user_id?: string | null
          confidence_score: number
          confidence_signals?: Json | null
          created_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          match_method?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          trust_tier?: number | null
          updated_at?: string | null
        }
        Update: {
          claim_id?: string | null
          claimant_email?: string
          claimant_name?: string | null
          claimant_user_id?: string | null
          confidence_score?: number
          confidence_signals?: Json | null
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          match_method?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          trust_tier?: number | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "claim_queue_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "exp_claim"
            referencedColumns: ["claim_id"]
          },
          {
            foreignKeyName: "claim_queue_claimant_user_id_fkey"
            columns: ["claimant_user_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "claim_queue_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      content_compliance_rules: {
        Row: {
          applies_to: string[]
          created_at: string | null
          gcid: string | null
          id: string
          is_active: boolean | null
          rule_name: string
          rule_type: string
          rule_value: string
          severity: string
        }
        Insert: {
          applies_to: string[]
          created_at?: string | null
          gcid?: string | null
          id?: string
          is_active?: boolean | null
          rule_name: string
          rule_type: string
          rule_value: string
          severity: string
        }
        Update: {
          applies_to?: string[]
          created_at?: string | null
          gcid?: string | null
          id?: string
          is_active?: boolean | null
          rule_name?: string
          rule_type?: string
          rule_value?: string
          severity?: string
        }
        Relationships: [
          {
            foreignKeyName: "content_compliance_rules_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "content_compliance_rules_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "content_compliance_rules_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "content_compliance_rules_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "content_compliance_rules_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "content_compliance_rules_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      content_items: {
        Row: {
          ai_mentions: number | null
          audio_generated: boolean | null
          audio_url: string | null
          author_id: string
          author_type: string
          body: string | null
          canonical_url: string | null
          compliance_checked: boolean | null
          compliance_flags: string[] | null
          compliance_passed: boolean | null
          content_type: string
          cover_image_url: string | null
          created_at: string | null
          disclosures_appended: string[] | null
          excerpt: string | null
          gcid: string | null
          graph_node_id: string | null
          id: string
          keywords: string[] | null
          locations_mentioned: string[] | null
          markets_covered: string[] | null
          meta_description: string | null
          meta_title: string | null
          published_at: string | null
          published_url: string | null
          schema_type: string | null
          shares: number | null
          slug: string | null
          social_shared: boolean | null
          status: string | null
          tag_ids: string[] | null
          title: string
          topic_ids: string[] | null
          updated_at: string | null
          views: number | null
          voce_published: boolean | null
        }
        Insert: {
          ai_mentions?: number | null
          audio_generated?: boolean | null
          audio_url?: string | null
          author_id: string
          author_type: string
          body?: string | null
          canonical_url?: string | null
          compliance_checked?: boolean | null
          compliance_flags?: string[] | null
          compliance_passed?: boolean | null
          content_type: string
          cover_image_url?: string | null
          created_at?: string | null
          disclosures_appended?: string[] | null
          excerpt?: string | null
          gcid?: string | null
          graph_node_id?: string | null
          id?: string
          keywords?: string[] | null
          locations_mentioned?: string[] | null
          markets_covered?: string[] | null
          meta_description?: string | null
          meta_title?: string | null
          published_at?: string | null
          published_url?: string | null
          schema_type?: string | null
          shares?: number | null
          slug?: string | null
          social_shared?: boolean | null
          status?: string | null
          tag_ids?: string[] | null
          title: string
          topic_ids?: string[] | null
          updated_at?: string | null
          views?: number | null
          voce_published?: boolean | null
        }
        Update: {
          ai_mentions?: number | null
          audio_generated?: boolean | null
          audio_url?: string | null
          author_id?: string
          author_type?: string
          body?: string | null
          canonical_url?: string | null
          compliance_checked?: boolean | null
          compliance_flags?: string[] | null
          compliance_passed?: boolean | null
          content_type?: string
          cover_image_url?: string | null
          created_at?: string | null
          disclosures_appended?: string[] | null
          excerpt?: string | null
          gcid?: string | null
          graph_node_id?: string | null
          id?: string
          keywords?: string[] | null
          locations_mentioned?: string[] | null
          markets_covered?: string[] | null
          meta_description?: string | null
          meta_title?: string | null
          published_at?: string | null
          published_url?: string | null
          schema_type?: string | null
          shares?: number | null
          slug?: string | null
          social_shared?: boolean | null
          status?: string | null
          tag_ids?: string[] | null
          title?: string
          topic_ids?: string[] | null
          updated_at?: string | null
          views?: number | null
          voce_published?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "content_items_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "content_items_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "content_items_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "content_items_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "content_items_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "content_items_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "content_items_graph_node_id_fkey"
            columns: ["graph_node_id"]
            isOneToOne: false
            referencedRelation: "graph_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      credentials: {
        Row: {
          created_at: string | null
          credential_type: string
          graph_node_id: string | null
          id: string
          identifier: string | null
          is_current: boolean | null
          issuing_org: string
          issuing_org_url: string | null
          issuing_state: string | null
          name: string
          professional_id: string
          schema_credential_category: string | null
          updated_at: string | null
          valid_from: string | null
          valid_until: string | null
          verification_method: string | null
          verification_url: string | null
          verified: boolean | null
          verified_at: string | null
          wikidata_id: string | null
        }
        Insert: {
          created_at?: string | null
          credential_type: string
          graph_node_id?: string | null
          id?: string
          identifier?: string | null
          is_current?: boolean | null
          issuing_org: string
          issuing_org_url?: string | null
          issuing_state?: string | null
          name: string
          professional_id: string
          schema_credential_category?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
          verification_method?: string | null
          verification_url?: string | null
          verified?: boolean | null
          verified_at?: string | null
          wikidata_id?: string | null
        }
        Update: {
          created_at?: string | null
          credential_type?: string
          graph_node_id?: string | null
          id?: string
          identifier?: string | null
          is_current?: boolean | null
          issuing_org?: string
          issuing_org_url?: string | null
          issuing_state?: string | null
          name?: string
          professional_id?: string
          schema_credential_category?: string | null
          updated_at?: string | null
          valid_from?: string | null
          valid_until?: string | null
          verification_method?: string | null
          verification_url?: string | null
          verified?: boolean | null
          verified_at?: string | null
          wikidata_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credentials_graph_node_id_fkey"
            columns: ["graph_node_id"]
            isOneToOne: false
            referencedRelation: "graph_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "v_compliance_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "v_plg_next_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "credentials_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "v_professional_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_integrations: {
        Row: {
          config: Json
          created_at: string | null
          crm_type: string
          display_name: string
          field_map: Json | null
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          org_id: string
          records_synced: number | null
          sync_direction: string | null
          sync_frequency: string | null
          sync_status: string | null
        }
        Insert: {
          config?: Json
          created_at?: string | null
          crm_type: string
          display_name: string
          field_map?: Json | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          org_id: string
          records_synced?: number | null
          sync_direction?: string | null
          sync_frequency?: string | null
          sync_status?: string | null
        }
        Update: {
          config?: Json
          created_at?: string | null
          crm_type?: string
          display_name?: string
          field_map?: Json | null
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          org_id?: string
          records_synced?: number | null
          sync_direction?: string | null
          sync_frequency?: string | null
          sync_status?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_integrations_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      disco_jobs: {
        Row: {
          category_slug: string
          created_at: string
          job_id: number
          note: string | null
          payload: Json
          result: Json | null
          status: string
          step: string
          updated_at: string
        }
        Insert: {
          category_slug: string
          created_at?: string
          job_id?: never
          note?: string | null
          payload?: Json
          result?: Json | null
          status?: string
          step: string
          updated_at?: string
        }
        Update: {
          category_slug?: string
          created_at?: string
          job_id?: never
          note?: string | null
          payload?: Json
          result?: Json | null
          status?: string
          step?: string
          updated_at?: string
        }
        Relationships: []
      }
      disco_llm_requests: {
        Row: {
          created_at: string
          job_id: number | null
          prompt_input: Json
          request_id: number
          response: Json | null
          status: string
          tool: string
        }
        Insert: {
          created_at?: string
          job_id?: number | null
          prompt_input: Json
          request_id?: never
          response?: Json | null
          status?: string
          tool: string
        }
        Update: {
          created_at?: string
          job_id?: number | null
          prompt_input?: Json
          request_id?: never
          response?: Json | null
          status?: string
          tool?: string
        }
        Relationships: [
          {
            foreignKeyName: "disco_llm_requests_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "disco_jobs"
            referencedColumns: ["job_id"]
          },
        ]
      }
      disco_proposals: {
        Row: {
          category_slug: string
          created_at: string
          decided_domains: string[]
          job_id: number | null
          kind: string
          payload: Json
          proposal_id: number
          state: string
        }
        Insert: {
          category_slug: string
          created_at?: string
          decided_domains?: string[]
          job_id?: number | null
          kind: string
          payload: Json
          proposal_id?: never
          state?: string
        }
        Update: {
          category_slug?: string
          created_at?: string
          decided_domains?: string[]
          job_id?: number | null
          kind?: string
          payload?: Json
          proposal_id?: never
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "disco_proposals_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "disco_jobs"
            referencedColumns: ["job_id"]
          },
        ]
      }
      disco_site_contract: {
        Row: {
          category_slug: string
          contract_id: number
          detail_entity_type: string | null
          detail_pattern: string | null
          domain: string
          extraction: Json
          field_floor: number
          learned_at: string
          learned_by: string
          method: string | null
          method_evidence: Json | null
          profile_sitemaps: string[] | null
          roster_pattern: string | null
        }
        Insert: {
          category_slug: string
          contract_id?: never
          detail_entity_type?: string | null
          detail_pattern?: string | null
          domain: string
          extraction?: Json
          field_floor?: number
          learned_at?: string
          learned_by?: string
          method?: string | null
          method_evidence?: Json | null
          profile_sitemaps?: string[] | null
          roster_pattern?: string | null
        }
        Update: {
          category_slug?: string
          contract_id?: never
          detail_entity_type?: string | null
          detail_pattern?: string | null
          domain?: string
          extraction?: Json
          field_floor?: number
          learned_at?: string
          learned_by?: string
          method?: string | null
          method_evidence?: Json | null
          profile_sitemaps?: string[] | null
          roster_pattern?: string | null
        }
        Relationships: []
      }
      enterprise_settings: {
        Row: {
          allow_org_posts: boolean | null
          brand_voice: string | null
          compliance_rules_override: string[] | null
          contract_end: string | null
          contract_start: string | null
          created_at: string | null
          feature_ai_agents: boolean | null
          feature_analytics: boolean | null
          feature_api_access: boolean | null
          feature_campaigns: boolean | null
          feature_crm_sync: boolean | null
          feature_listings: boolean | null
          feature_reviews: boolean | null
          feature_voce: boolean | null
          feature_websites: boolean | null
          id: string
          org_id: string
          pii_restrictions: string[] | null
          pricing_tier: string | null
          require_post_approval: boolean | null
          review_pii_filter: boolean | null
          updated_at: string | null
        }
        Insert: {
          allow_org_posts?: boolean | null
          brand_voice?: string | null
          compliance_rules_override?: string[] | null
          contract_end?: string | null
          contract_start?: string | null
          created_at?: string | null
          feature_ai_agents?: boolean | null
          feature_analytics?: boolean | null
          feature_api_access?: boolean | null
          feature_campaigns?: boolean | null
          feature_crm_sync?: boolean | null
          feature_listings?: boolean | null
          feature_reviews?: boolean | null
          feature_voce?: boolean | null
          feature_websites?: boolean | null
          id?: string
          org_id: string
          pii_restrictions?: string[] | null
          pricing_tier?: string | null
          require_post_approval?: boolean | null
          review_pii_filter?: boolean | null
          updated_at?: string | null
        }
        Update: {
          allow_org_posts?: boolean | null
          brand_voice?: string | null
          compliance_rules_override?: string[] | null
          contract_end?: string | null
          contract_start?: string | null
          created_at?: string | null
          feature_ai_agents?: boolean | null
          feature_analytics?: boolean | null
          feature_api_access?: boolean | null
          feature_campaigns?: boolean | null
          feature_crm_sync?: boolean | null
          feature_listings?: boolean | null
          feature_reviews?: boolean | null
          feature_voce?: boolean | null
          feature_websites?: boolean | null
          id?: string
          org_id?: string
          pii_restrictions?: string[] | null
          pricing_tier?: string | null
          require_post_approval?: boolean | null
          review_pii_filter?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "enterprise_settings_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      entity_compliance: {
        Row: {
          age_gate_active: boolean | null
          age_gate_verified_at: string | null
          ccpa_opt_out: boolean | null
          compliance_score: number | null
          created_at: string | null
          disclaimers_accepted: boolean | null
          disclaimers_accepted_at: string | null
          disclaimers_shown: boolean | null
          entity_id: string
          entity_type: string
          gdpr_consent: boolean | null
          gdpr_consent_at: string | null
          last_reviewed: string | null
          license_display_verified: boolean | null
          license_displayed: boolean | null
          missing_items: string[] | null
          privacy_accepted: boolean | null
          privacy_accepted_at: string | null
          terms_accepted: boolean | null
          terms_accepted_at: string | null
          terms_version: string | null
          updated_at: string | null
        }
        Insert: {
          age_gate_active?: boolean | null
          age_gate_verified_at?: string | null
          ccpa_opt_out?: boolean | null
          compliance_score?: number | null
          created_at?: string | null
          disclaimers_accepted?: boolean | null
          disclaimers_accepted_at?: string | null
          disclaimers_shown?: boolean | null
          entity_id: string
          entity_type: string
          gdpr_consent?: boolean | null
          gdpr_consent_at?: string | null
          last_reviewed?: string | null
          license_display_verified?: boolean | null
          license_displayed?: boolean | null
          missing_items?: string[] | null
          privacy_accepted?: boolean | null
          privacy_accepted_at?: string | null
          terms_accepted?: boolean | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string | null
        }
        Update: {
          age_gate_active?: boolean | null
          age_gate_verified_at?: string | null
          ccpa_opt_out?: boolean | null
          compliance_score?: number | null
          created_at?: string | null
          disclaimers_accepted?: boolean | null
          disclaimers_accepted_at?: string | null
          disclaimers_shown?: boolean | null
          entity_id?: string
          entity_type?: string
          gdpr_consent?: boolean | null
          gdpr_consent_at?: string | null
          last_reviewed?: string | null
          license_display_verified?: boolean | null
          license_displayed?: boolean | null
          missing_items?: string[] | null
          privacy_accepted?: boolean | null
          privacy_accepted_at?: string | null
          terms_accepted?: boolean | null
          terms_accepted_at?: string | null
          terms_version?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      etl_sources: {
        Row: {
          crawled_at: string | null
          created_at: string | null
          data_quality: number | null
          entity_id: string
          entity_type: string
          id: string
          raw_data: Json | null
          source_name: string | null
          source_type: string
          source_url: string | null
        }
        Insert: {
          crawled_at?: string | null
          created_at?: string | null
          data_quality?: number | null
          entity_id: string
          entity_type: string
          id?: string
          raw_data?: Json | null
          source_name?: string | null
          source_type: string
          source_url?: string | null
        }
        Update: {
          crawled_at?: string | null
          created_at?: string | null
          data_quality?: number | null
          entity_id?: string
          entity_type?: string
          id?: string
          raw_data?: Json | null
          source_name?: string | null
          source_type?: string
          source_url?: string | null
        }
        Relationships: []
      }
      exp_account_tier: {
        Row: {
          account_id: string
          agent_count: number | null
          group_key: string | null
          tier: string
          updated_at: string | null
        }
        Insert: {
          account_id: string
          agent_count?: number | null
          group_key?: string | null
          tier: string
          updated_at?: string | null
        }
        Update: {
          account_id?: string
          agent_count?: number | null
          group_key?: string | null
          tier?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      exp_accounts: {
        Row: {
          account_stage: string
          account_type: string | null
          active_arr: number | null
          category: string | null
          city: string | null
          country: string | null
          created_at: string | null
          csm_id: string | null
          customer_type: string | null
          demo_batch: string | null
          domain: string | null
          id: string
          industry: string | null
          is_demo: boolean | null
          legal_name: string | null
          name: string
          org_id: string | null
          owner_id: string | null
          phone: string | null
          postal_code: string | null
          region: string | null
          renewal_type: string | null
          source: string | null
          street: string | null
          updated_at: string | null
          website: string | null
        }
        Insert: {
          account_stage?: string
          account_type?: string | null
          active_arr?: number | null
          category?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          csm_id?: string | null
          customer_type?: string | null
          demo_batch?: string | null
          domain?: string | null
          id?: string
          industry?: string | null
          is_demo?: boolean | null
          legal_name?: string | null
          name: string
          org_id?: string | null
          owner_id?: string | null
          phone?: string | null
          postal_code?: string | null
          region?: string | null
          renewal_type?: string | null
          source?: string | null
          street?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Update: {
          account_stage?: string
          account_type?: string | null
          active_arr?: number | null
          category?: string | null
          city?: string | null
          country?: string | null
          created_at?: string | null
          csm_id?: string | null
          customer_type?: string | null
          demo_batch?: string | null
          domain?: string | null
          id?: string
          industry?: string | null
          is_demo?: boolean | null
          legal_name?: string | null
          name?: string
          org_id?: string | null
          owner_id?: string | null
          phone?: string | null
          postal_code?: string | null
          region?: string | null
          renewal_type?: string | null
          source?: string | null
          street?: string | null
          updated_at?: string | null
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_accounts_csm_id_fkey"
            columns: ["csm_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_accounts_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_activity_events: {
        Row: {
          account_id: string | null
          actor: string | null
          demo_batch: string | null
          event_type: string
          external_id: string | null
          id: string
          is_demo: boolean | null
          location: string | null
          logo: string | null
          occurred_at: string | null
          source: string | null
          subject_id: string | null
          subject_type: string | null
          value: Json | null
        }
        Insert: {
          account_id?: string | null
          actor?: string | null
          demo_batch?: string | null
          event_type: string
          external_id?: string | null
          id?: string
          is_demo?: boolean | null
          location?: string | null
          logo?: string | null
          occurred_at?: string | null
          source?: string | null
          subject_id?: string | null
          subject_type?: string | null
          value?: Json | null
        }
        Update: {
          account_id?: string | null
          actor?: string | null
          demo_batch?: string | null
          event_type?: string
          external_id?: string | null
          id?: string
          is_demo?: boolean | null
          location?: string | null
          logo?: string | null
          occurred_at?: string | null
          source?: string | null
          subject_id?: string | null
          subject_type?: string | null
          value?: Json | null
        }
        Relationships: []
      }
      exp_admin_audit: {
        Row: {
          acting_role: string | null
          action: string
          created_at: string
          details: Json
          id: string
          target: string | null
          user_id: string
        }
        Insert: {
          acting_role?: string | null
          action: string
          created_at?: string
          details?: Json
          id?: string
          target?: string | null
          user_id: string
        }
        Update: {
          acting_role?: string | null
          action?: string
          created_at?: string
          details?: Json
          id?: string
          target?: string | null
          user_id?: string
        }
        Relationships: []
      }
      exp_app_config: {
        Row: {
          key: string
          value: string | null
        }
        Insert: {
          key: string
          value?: string | null
        }
        Update: {
          key?: string
          value?: string | null
        }
        Relationships: []
      }
      exp_audit_both: {
        Row: {
          metric: string | null
          section: string | null
          value: string | null
        }
        Insert: {
          metric?: string | null
          section?: string | null
          value?: string | null
        }
        Update: {
          metric?: string | null
          section?: string | null
          value?: string | null
        }
        Relationships: []
      }
      exp_audit_counts: {
        Row: {
          n: number | null
          section: string | null
        }
        Insert: {
          n?: number | null
          section?: string | null
        }
        Update: {
          n?: number | null
          section?: string | null
        }
        Relationships: []
      }
      exp_audit_requests: {
        Row: {
          batch: number | null
          created_at: string | null
          request_id: number
        }
        Insert: {
          batch?: number | null
          created_at?: string | null
          request_id: number
        }
        Update: {
          batch?: number | null
          created_at?: string | null
          request_id?: number
        }
        Relationships: []
      }
      exp_bloat_log: {
        Row: {
          ran_at: string | null
          removed: number | null
        }
        Insert: {
          ran_at?: string | null
          removed?: number | null
        }
        Update: {
          ran_at?: string | null
          removed?: number | null
        }
        Relationships: []
      }
      exp_brand_adoption: {
        Row: {
          active_users: number | null
          engaged_users: number | null
          group_key: string | null
          id: string
          is_demo: boolean | null
          org_id: string | null
          referral_location: string | null
          referral_marketing: string | null
          referral_regional: string | null
          updated_at: string | null
        }
        Insert: {
          active_users?: number | null
          engaged_users?: number | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          org_id?: string | null
          referral_location?: string | null
          referral_marketing?: string | null
          referral_regional?: string | null
          updated_at?: string | null
        }
        Update: {
          active_users?: number | null
          engaged_users?: number | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          org_id?: string | null
          referral_location?: string | null
          referral_marketing?: string | null
          referral_regional?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      exp_build_map: {
        Row: {
          consumes_event: string | null
          created_at: string
          description: string | null
          emits_event: string | null
          id: string
          notes: string | null
          sort_order: number
          state: string
          step_no: number
          title: string
          track: string
        }
        Insert: {
          consumes_event?: string | null
          created_at?: string
          description?: string | null
          emits_event?: string | null
          id?: string
          notes?: string | null
          sort_order?: number
          state?: string
          step_no: number
          title: string
          track?: string
        }
        Update: {
          consumes_event?: string | null
          created_at?: string
          description?: string | null
          emits_event?: string | null
          id?: string
          notes?: string | null
          sort_order?: number
          state?: string
          step_no?: number
          title?: string
          track?: string
        }
        Relationships: []
      }
      exp_capability_registry: {
        Row: {
          created_at: string
          description: string | null
          dry_run: boolean
          entitlement_required: string | null
          events_emitted: string[]
          id: string
          idempotent_key: string | null
          inputs: Json
          key: string
          outputs: Json
          owning_surface: string
          reads_state: string[]
          side_effects: string[]
          status: string
          title: string
          transport: string
          updated_at: string
          version: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          dry_run?: boolean
          entitlement_required?: string | null
          events_emitted?: string[]
          id?: string
          idempotent_key?: string | null
          inputs?: Json
          key: string
          outputs?: Json
          owning_surface: string
          reads_state?: string[]
          side_effects?: string[]
          status?: string
          title: string
          transport?: string
          updated_at?: string
          version?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          dry_run?: boolean
          entitlement_required?: string | null
          events_emitted?: string[]
          id?: string
          idempotent_key?: string | null
          inputs?: Json
          key?: string
          outputs?: Json
          owning_surface?: string
          reads_state?: string[]
          side_effects?: string[]
          status?: string
          title?: string
          transport?: string
          updated_at?: string
          version?: string
        }
        Relationships: []
      }
      exp_category_boundary: {
        Row: {
          definition: string
          excludes: Json
          gcid: string
          includes: Json
          source: string
          subtypes: Json
          updated_at: string
        }
        Insert: {
          definition: string
          excludes?: Json
          gcid: string
          includes?: Json
          source?: string
          subtypes?: Json
          updated_at?: string
        }
        Update: {
          definition?: string
          excludes?: Json
          gcid?: string
          includes?: Json
          source?: string
          subtypes?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_boundary_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_boundary_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_boundary_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_boundary_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_boundary_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_boundary_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_completeness: {
        Row: {
          core_node_types: number
          expected_m: number
          gcid: string
          method_version: string
          provenance: string
          total_node_types: number
        }
        Insert: {
          core_node_types: number
          expected_m: number
          gcid: string
          method_version?: string
          provenance?: string
          total_node_types: number
        }
        Update: {
          core_node_types?: number
          expected_m?: number
          gcid?: string
          method_version?: string
          provenance?: string
          total_node_types?: number
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_completeness_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_completeness_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_completeness_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_completeness_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_completeness_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_completeness_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_complexity: {
        Row: {
          assessed_at: string
          gcid: string
          score: number
          signals: Json
          tier: string
        }
        Insert: {
          assessed_at?: string
          gcid: string
          score: number
          signals: Json
          tier: string
        }
        Update: {
          assessed_at?: string
          gcid?: string
          score?: number
          signals?: Json
          tier?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_complexity_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_complexity_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_complexity_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_complexity_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_complexity_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_complexity_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_compliance: {
        Row: {
          advertising_rules_url: string | null
          age_gate_minimum: number | null
          age_gate_required: boolean | null
          age_gate_type: string | null
          compliance_notes: string | null
          content_restrictions: string[] | null
          coppa_applies: boolean | null
          created_at: string | null
          disclaimer_placement: string[] | null
          display_license_on_ads: boolean | null
          display_license_on_content: boolean | null
          display_license_on_email: boolean | null
          display_license_on_profile: boolean | null
          ferpa_applies: boolean | null
          gcid: string
          glba_applies: boolean | null
          hipaa_applies: boolean | null
          license_display_format: string | null
          license_label: string | null
          prohibited_phrases: string[] | null
          regulated_by: string[] | null
          required_disclaimers: string[] | null
          required_disclosures: string[] | null
          review_transaction_required: boolean | null
          review_verification_required: boolean | null
          updated_at: string | null
        }
        Insert: {
          advertising_rules_url?: string | null
          age_gate_minimum?: number | null
          age_gate_required?: boolean | null
          age_gate_type?: string | null
          compliance_notes?: string | null
          content_restrictions?: string[] | null
          coppa_applies?: boolean | null
          created_at?: string | null
          disclaimer_placement?: string[] | null
          display_license_on_ads?: boolean | null
          display_license_on_content?: boolean | null
          display_license_on_email?: boolean | null
          display_license_on_profile?: boolean | null
          ferpa_applies?: boolean | null
          gcid: string
          glba_applies?: boolean | null
          hipaa_applies?: boolean | null
          license_display_format?: string | null
          license_label?: string | null
          prohibited_phrases?: string[] | null
          regulated_by?: string[] | null
          required_disclaimers?: string[] | null
          required_disclosures?: string[] | null
          review_transaction_required?: boolean | null
          review_verification_required?: boolean | null
          updated_at?: string | null
        }
        Update: {
          advertising_rules_url?: string | null
          age_gate_minimum?: number | null
          age_gate_required?: boolean | null
          age_gate_type?: string | null
          compliance_notes?: string | null
          content_restrictions?: string[] | null
          coppa_applies?: boolean | null
          created_at?: string | null
          disclaimer_placement?: string[] | null
          display_license_on_ads?: boolean | null
          display_license_on_content?: boolean | null
          display_license_on_email?: boolean | null
          display_license_on_profile?: boolean | null
          ferpa_applies?: boolean | null
          gcid?: string
          glba_applies?: boolean | null
          hipaa_applies?: boolean | null
          license_display_format?: string | null
          license_label?: string | null
          prohibited_phrases?: string[] | null
          regulated_by?: string[] | null
          required_disclaimers?: string[] | null
          required_disclosures?: string[] | null
          review_transaction_required?: boolean | null
          review_verification_required?: boolean | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_compliance_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_compliance_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_compliance_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_compliance_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_compliance_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_compliance_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_directories: {
        Row: {
          directory_key: string
          directory_name: string
          gcid: string
          id: string
          is_required: boolean | null
          notes: string | null
          priority: number | null
          schema_type: string | null
        }
        Insert: {
          directory_key: string
          directory_name: string
          gcid: string
          id?: string
          is_required?: boolean | null
          notes?: string | null
          priority?: number | null
          schema_type?: string | null
        }
        Update: {
          directory_key?: string
          directory_name?: string
          gcid?: string
          id?: string
          is_required?: boolean | null
          notes?: string | null
          priority?: number | null
          schema_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_directories_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_directories_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_directories_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_directories_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_directories_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_directories_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_directory_map: {
        Row: {
          created_at: string
          directory_key: string
          gcid: string
          id: string
          is_active: boolean
          source: string
        }
        Insert: {
          created_at?: string
          directory_key: string
          gcid: string
          id?: string
          is_active?: boolean
          source?: string
        }
        Update: {
          created_at?: string
          directory_key?: string
          gcid?: string
          id?: string
          is_active?: boolean
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_directory_map_directory_key_fkey"
            columns: ["directory_key"]
            isOneToOne: false
            referencedRelation: "exp_directory_packs"
            referencedColumns: ["directory_key"]
          },
          {
            foreignKeyName: "exp_category_directory_map_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_directory_map_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_directory_map_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_directory_map_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_directory_map_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_directory_map_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_eaa: {
        Row: {
          annual_transactions: number
          band: string
          band_professional: string | null
          confidence: string | null
          eaa: number
          eaa_professional: number | null
          gcid: string
          method_version: string
          non_authored: boolean
          provenance: string
        }
        Insert: {
          annual_transactions: number
          band: string
          band_professional?: string | null
          confidence?: string | null
          eaa: number
          eaa_professional?: number | null
          gcid: string
          method_version?: string
          non_authored?: boolean
          provenance?: string
        }
        Update: {
          annual_transactions?: number
          band?: string
          band_professional?: string | null
          confidence?: string | null
          eaa?: number
          eaa_professional?: number | null
          gcid?: string
          method_version?: string
          non_authored?: boolean
          provenance?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_eaa_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eaa_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eaa_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eaa_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eaa_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eaa_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_eap: {
        Row: {
          annual_transactions: number
          band: string
          band_professional: string | null
          confidence: string | null
          eap: number
          eap_professional: number | null
          gcid: string
          method_version: string
          non_posting: boolean
          provenance: string
        }
        Insert: {
          annual_transactions: number
          band: string
          band_professional?: string | null
          confidence?: string | null
          eap: number
          eap_professional?: number | null
          gcid: string
          method_version?: string
          non_posting?: boolean
          provenance?: string
        }
        Update: {
          annual_transactions?: number
          band?: string
          band_professional?: string | null
          confidence?: string | null
          eap?: number
          eap_professional?: number | null
          gcid?: string
          method_version?: string
          non_posting?: boolean
          provenance?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_eap_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eap_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eap_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eap_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eap_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eap_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_eaq: {
        Row: {
          annual_transactions: number
          band: string
          band_professional: string | null
          confidence: string | null
          eaq: number
          eaq_professional: number | null
          gcid: string
          method_version: string
          non_qa: boolean
          provenance: string
        }
        Insert: {
          annual_transactions: number
          band: string
          band_professional?: string | null
          confidence?: string | null
          eaq: number
          eaq_professional?: number | null
          gcid: string
          method_version?: string
          non_qa?: boolean
          provenance?: string
        }
        Update: {
          annual_transactions?: number
          band?: string
          band_professional?: string | null
          confidence?: string | null
          eaq?: number
          eaq_professional?: number | null
          gcid?: string
          method_version?: string
          non_qa?: boolean
          provenance?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_eaq_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eaq_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eaq_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eaq_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eaq_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eaq_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_ear: {
        Row: {
          annual_transactions: number
          band: string
          band_professional: string | null
          confidence: string | null
          ear: number
          ear_professional: number | null
          gcid: string
          method_version: string
          non_reviewable: boolean
          provenance: string
        }
        Insert: {
          annual_transactions: number
          band: string
          band_professional?: string | null
          confidence?: string | null
          ear: number
          ear_professional?: number | null
          gcid: string
          method_version?: string
          non_reviewable?: boolean
          provenance?: string
        }
        Update: {
          annual_transactions?: number
          band?: string
          band_professional?: string | null
          confidence?: string | null
          ear?: number
          ear_professional?: number | null
          gcid?: string
          method_version?: string
          non_reviewable?: boolean
          provenance?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_ear_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_ear_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_ear_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_ear_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_ear_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_ear_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_eav: {
        Row: {
          annual_transactions: number
          band: string
          band_professional: string | null
          confidence: string | null
          eav: number
          eav_professional: number | null
          gcid: string
          method_version: string
          non_video: boolean
          provenance: string
        }
        Insert: {
          annual_transactions: number
          band: string
          band_professional?: string | null
          confidence?: string | null
          eav: number
          eav_professional?: number | null
          gcid: string
          method_version?: string
          non_video?: boolean
          provenance?: string
        }
        Update: {
          annual_transactions?: number
          band?: string
          band_professional?: string | null
          confidence?: string | null
          eav?: number
          eav_professional?: number | null
          gcid?: string
          method_version?: string
          non_video?: boolean
          provenance?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_eav_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eav_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eav_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eav_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eav_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_eav_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_group_members: {
        Row: {
          created_at: string | null
          gcid: string | null
          group_key: string | null
          id: string
        }
        Insert: {
          created_at?: string | null
          gcid?: string | null
          group_key?: string | null
          id?: string
        }
        Update: {
          created_at?: string | null
          gcid?: string | null
          group_key?: string | null
          id?: string
        }
        Relationships: []
      }
      exp_category_group_memberships: {
        Row: {
          gcid: string
          group_id: string
          is_primary: boolean | null
        }
        Insert: {
          gcid: string
          group_id: string
          is_primary?: boolean | null
        }
        Update: {
          gcid?: string
          group_id?: string
          is_primary?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_group_memberships_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_group_memberships_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_group_memberships_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_group_memberships_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_group_memberships_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_group_memberships_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_groups: {
        Row: {
          created_at: string | null
          description: string | null
          group_key: string | null
          id: string
          is_catchall: boolean | null
          is_launch_priority: boolean | null
          label: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          group_key?: string | null
          id?: string
          is_catchall?: boolean | null
          is_launch_priority?: boolean | null
          label?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          group_key?: string | null
          id?: string
          is_catchall?: boolean | null
          is_launch_priority?: boolean | null
          label?: string | null
        }
        Relationships: []
      }
      exp_category_knowledge: {
        Row: {
          ai_agents: Json | null
          compliance_rules: string[] | null
          content_topics: string[] | null
          conversion_actions: Json | null
          created_at: string | null
          customer_journey: Json | null
          entity_type: string
          exclusion_reason: string | null
          expertise_signals: Json | null
          gcid: string
          id: string
          is_launched: boolean | null
          knowledge_pct: number | null
          pricing_tier: string
          ranking_factors: Json | null
          review_vocabulary: string[] | null
          scoring_weights: Json | null
          search_intents: Json | null
          services: Json | null
          status: string
          terminology: string[] | null
          updated_at: string | null
          value_props: Json | null
        }
        Insert: {
          ai_agents?: Json | null
          compliance_rules?: string[] | null
          content_topics?: string[] | null
          conversion_actions?: Json | null
          created_at?: string | null
          customer_journey?: Json | null
          entity_type: string
          exclusion_reason?: string | null
          expertise_signals?: Json | null
          gcid: string
          id?: string
          is_launched?: boolean | null
          knowledge_pct?: number | null
          pricing_tier: string
          ranking_factors?: Json | null
          review_vocabulary?: string[] | null
          scoring_weights?: Json | null
          search_intents?: Json | null
          services?: Json | null
          status?: string
          terminology?: string[] | null
          updated_at?: string | null
          value_props?: Json | null
        }
        Update: {
          ai_agents?: Json | null
          compliance_rules?: string[] | null
          content_topics?: string[] | null
          conversion_actions?: Json | null
          created_at?: string | null
          customer_journey?: Json | null
          entity_type?: string
          exclusion_reason?: string | null
          expertise_signals?: Json | null
          gcid?: string
          id?: string
          is_launched?: boolean | null
          knowledge_pct?: number | null
          pricing_tier?: string
          ranking_factors?: Json | null
          review_vocabulary?: string[] | null
          scoring_weights?: Json | null
          search_intents?: Json | null
          services?: Json | null
          status?: string
          terminology?: string[] | null
          updated_at?: string | null
          value_props?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_knowledge_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_knowledge_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_knowledge_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_knowledge_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_knowledge_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_knowledge_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_page_template: {
        Row: {
          completeness_floor: number
          entity_type: string
          gcid: string
          hero_cta: string | null
          id: string
          is_demo: boolean | null
          notes: string | null
          required_sections: Json
          schema_type: string | null
          sections: Json
          updated_at: string | null
        }
        Insert: {
          completeness_floor?: number
          entity_type: string
          gcid: string
          hero_cta?: string | null
          id?: string
          is_demo?: boolean | null
          notes?: string | null
          required_sections?: Json
          schema_type?: string | null
          sections?: Json
          updated_at?: string | null
        }
        Update: {
          completeness_floor?: number
          entity_type?: string
          gcid?: string
          hero_cta?: string | null
          id?: string
          is_demo?: boolean | null
          notes?: string | null
          required_sections?: Json
          schema_type?: string | null
          sections?: Json
          updated_at?: string | null
        }
        Relationships: []
      }
      exp_category_profile_config: {
        Row: {
          credential_id_label: string | null
          credential_label: string | null
          cta_label: string | null
          entity_noun: string | null
          gcid: string
          schema_type: string | null
          service_label: string | null
          show_prequalify: boolean | null
          updated_at: string | null
        }
        Insert: {
          credential_id_label?: string | null
          credential_label?: string | null
          cta_label?: string | null
          entity_noun?: string | null
          gcid: string
          schema_type?: string | null
          service_label?: string | null
          show_prequalify?: boolean | null
          updated_at?: string | null
        }
        Update: {
          credential_id_label?: string | null
          credential_label?: string | null
          cta_label?: string | null
          entity_noun?: string | null
          gcid?: string
          schema_type?: string | null
          service_label?: string | null
          show_prequalify?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      exp_category_proposals: {
        Row: {
          applied_at: string | null
          batch: string
          before: Json | null
          created_at: string
          created_by: string
          error: string | null
          gcid: string
          id: number
          lane: string
          op: string
          payload: Json
          rationale: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          rule: string
          state: string
          target_key: Json
          target_table: string
        }
        Insert: {
          applied_at?: string | null
          batch: string
          before?: Json | null
          created_at?: string
          created_by?: string
          error?: string | null
          gcid: string
          id?: never
          lane: string
          op: string
          payload?: Json
          rationale: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule: string
          state?: string
          target_key: Json
          target_table: string
        }
        Update: {
          applied_at?: string | null
          batch?: string
          before?: Json | null
          created_at?: string
          created_by?: string
          error?: string | null
          gcid?: string
          id?: never
          lane?: string
          op?: string
          payload?: Json
          rationale?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          rule?: string
          state?: string
          target_key?: Json
          target_table?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_proposals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_proposals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_proposals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_proposals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_proposals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_proposals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_schema: {
        Row: {
          entity_type: string | null
          field_model_v3: Json | null
          gcid: string
          generated_at: string
          generated_by: string | null
          is_launched: boolean
          knowledge_updated_at: string | null
          model: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          schema_json: Json
          updated_at: string
        }
        Insert: {
          entity_type?: string | null
          field_model_v3?: Json | null
          gcid: string
          generated_at?: string
          generated_by?: string | null
          is_launched?: boolean
          knowledge_updated_at?: string | null
          model?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          schema_json: Json
          updated_at?: string
        }
        Update: {
          entity_type?: string | null
          field_model_v3?: Json | null
          gcid?: string
          generated_at?: string
          generated_by?: string | null
          is_launched?: boolean
          knowledge_updated_at?: string | null
          model?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          schema_json?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_schema_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_schema_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_schema_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_schema_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_schema_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_schema_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_schema_type: {
        Row: {
          confidence: string | null
          gcid: string
          rule: string | null
          schema_type: string | null
        }
        Insert: {
          confidence?: string | null
          gcid: string
          rule?: string | null
          schema_type?: string | null
        }
        Update: {
          confidence?: string | null
          gcid?: string
          rule?: string | null
          schema_type?: string | null
        }
        Relationships: []
      }
      exp_category_score_config: {
        Row: {
          archetype: string | null
          critical_multipliers: string[] | null
          gcid: string
          required_slugs: string[] | null
          updated_at: string | null
          version: string | null
        }
        Insert: {
          archetype?: string | null
          critical_multipliers?: string[] | null
          gcid: string
          required_slugs?: string[] | null
          updated_at?: string | null
          version?: string | null
        }
        Update: {
          archetype?: string | null
          critical_multipliers?: string[] | null
          gcid?: string
          required_slugs?: string[] | null
          updated_at?: string | null
          version?: string | null
        }
        Relationships: []
      }
      exp_category_secondaries: {
        Row: {
          notes: string | null
          primary_gcid: string
          relevance: number | null
          secondary_gcid: string
        }
        Insert: {
          notes?: string | null
          primary_gcid: string
          relevance?: number | null
          secondary_gcid: string
        }
        Update: {
          notes?: string | null
          primary_gcid?: string
          relevance?: number | null
          secondary_gcid?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_secondaries_primary_gcid_fkey"
            columns: ["primary_gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_secondaries_primary_gcid_fkey"
            columns: ["primary_gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_secondaries_primary_gcid_fkey"
            columns: ["primary_gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_secondaries_primary_gcid_fkey"
            columns: ["primary_gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_secondaries_primary_gcid_fkey"
            columns: ["primary_gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_secondaries_primary_gcid_fkey"
            columns: ["primary_gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_secondaries_secondary_gcid_fkey"
            columns: ["secondary_gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_secondaries_secondary_gcid_fkey"
            columns: ["secondary_gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_secondaries_secondary_gcid_fkey"
            columns: ["secondary_gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_secondaries_secondary_gcid_fkey"
            columns: ["secondary_gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_secondaries_secondary_gcid_fkey"
            columns: ["secondary_gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_secondaries_secondary_gcid_fkey"
            columns: ["secondary_gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_shape: {
        Row: {
          allowed_entity_types: string[]
          allowed_relationships: string[]
          claimable_types: string[]
          created_at: string
          gcid: string
          identity_keys: Json
          monetizable_types: string[]
          multi_affiliation_allowed: boolean
          required_entity_types: string[]
          ruled_by: string
          shape: string
          teams_allowed: boolean
        }
        Insert: {
          allowed_entity_types: string[]
          allowed_relationships: string[]
          claimable_types: string[]
          created_at?: string
          gcid: string
          identity_keys?: Json
          monetizable_types: string[]
          multi_affiliation_allowed?: boolean
          required_entity_types?: string[]
          ruled_by?: string
          shape: string
          teams_allowed?: boolean
        }
        Update: {
          allowed_entity_types?: string[]
          allowed_relationships?: string[]
          claimable_types?: string[]
          created_at?: string
          gcid?: string
          identity_keys?: Json
          monetizable_types?: string[]
          multi_affiliation_allowed?: boolean
          required_entity_types?: string[]
          ruled_by?: string
          shape?: string
          teams_allowed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_shape_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_shape_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_shape_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_shape_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_shape_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_shape_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: true
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_category_ui_config: {
        Row: {
          created_at: string | null
          entity_type: string
          gcid: string
          onboarding_steps: Json
          profile_page_template: string | null
          profile_sections: Json
          recommended_fields: string[] | null
          required_fields: string[] | null
          schema_template: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          entity_type?: string
          gcid: string
          onboarding_steps?: Json
          profile_page_template?: string | null
          profile_sections?: Json
          recommended_fields?: string[] | null
          required_fields?: string[] | null
          schema_template?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          entity_type?: string
          gcid?: string
          onboarding_steps?: Json
          profile_page_template?: string | null
          profile_sections?: Json
          recommended_fields?: string[] | null
          required_fields?: string[] | null
          schema_template?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_ui_config_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_ui_config_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_ui_config_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_ui_config_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_ui_config_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_ui_config_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_claim: {
        Row: {
          claim_id: string
          claim_type: string
          created_at: string
          entity_id: string
          evidence: Json | null
          released_at: string | null
          status: string
          tier_path: string | null
          trust_tier: number
          updated_at: string
          user_id: string
          verified_at: string | null
        }
        Insert: {
          claim_id?: string
          claim_type?: string
          created_at?: string
          entity_id: string
          evidence?: Json | null
          released_at?: string | null
          status?: string
          tier_path?: string | null
          trust_tier?: number
          updated_at?: string
          user_id: string
          verified_at?: string | null
        }
        Update: {
          claim_id?: string
          claim_type?: string
          created_at?: string
          entity_id?: string
          evidence?: Json | null
          released_at?: string | null
          status?: string
          tier_path?: string | null
          trust_tier?: number
          updated_at?: string
          user_id?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_claim_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "exp_entity"
            referencedColumns: ["entity_id"]
          },
        ]
      }
      exp_claim_events: {
        Row: {
          claim_id: string | null
          contact_email: string | null
          contact_phone: string | null
          contact_updated_at: string | null
          contact_updated_by: string | null
          demo_batch: string | null
          entity_id: string | null
          entity_label: string | null
          entity_type: string | null
          event_type: string | null
          group_key: string | null
          id: string
          is_demo: boolean | null
          logo_org_id: string | null
          nora_engagement: number | null
          occurred_at: string | null
          seller_id: string | null
          state: string | null
          territory_id: string | null
          upgraded: boolean | null
        }
        Insert: {
          claim_id?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          contact_updated_at?: string | null
          contact_updated_by?: string | null
          demo_batch?: string | null
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string | null
          event_type?: string | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          logo_org_id?: string | null
          nora_engagement?: number | null
          occurred_at?: string | null
          seller_id?: string | null
          state?: string | null
          territory_id?: string | null
          upgraded?: boolean | null
        }
        Update: {
          claim_id?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          contact_updated_at?: string | null
          contact_updated_by?: string | null
          demo_batch?: string | null
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string | null
          event_type?: string | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          logo_org_id?: string | null
          nora_engagement?: number | null
          occurred_at?: string | null
          seller_id?: string | null
          state?: string | null
          territory_id?: string | null
          upgraded?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_claim_events_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "exp_claim"
            referencedColumns: ["claim_id"]
          },
        ]
      }
      exp_comp_plans: {
        Row: {
          active: boolean
          basis: string
          created_at: string
          id: string
          is_demo: boolean
          name: string
          notes: string | null
          rate_pct: number
          role: string
        }
        Insert: {
          active?: boolean
          basis?: string
          created_at?: string
          id?: string
          is_demo?: boolean
          name: string
          notes?: string | null
          rate_pct?: number
          role: string
        }
        Update: {
          active?: boolean
          basis?: string
          created_at?: string
          id?: string
          is_demo?: boolean
          name?: string
          notes?: string | null
          rate_pct?: number
          role?: string
        }
        Relationships: []
      }
      exp_contacts: {
        Row: {
          account_id: string | null
          created_at: string | null
          demo_batch: string | null
          email: string | null
          first_name: string | null
          id: string
          is_demo: boolean | null
          job_title: string | null
          last_name: string | null
          phone: string | null
          professional_id: string | null
          source_origin: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          demo_batch?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          is_demo?: boolean | null
          job_title?: string | null
          last_name?: string | null
          phone?: string | null
          professional_id?: string | null
          source_origin?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          demo_batch?: string | null
          email?: string | null
          first_name?: string | null
          id?: string
          is_demo?: boolean | null
          job_title?: string | null
          last_name?: string | null
          phone?: string | null
          professional_id?: string | null
          source_origin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_contacts_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exp_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_contract_activity: {
        Row: {
          actor: string | null
          contract_id: string
          detail: Json | null
          event_type: string
          id: string
          occurred_at: string | null
        }
        Insert: {
          actor?: string | null
          contract_id: string
          detail?: Json | null
          event_type: string
          id?: string
          occurred_at?: string | null
        }
        Update: {
          actor?: string | null
          contract_id?: string
          detail?: Json | null
          event_type?: string
          id?: string
          occurred_at?: string | null
        }
        Relationships: []
      }
      exp_contract_approvals: {
        Row: {
          approver_name: string | null
          approver_role: string | null
          contract_id: string
          decided_at: string | null
          demo_batch: string | null
          email: string | null
          id: string
          is_demo: boolean | null
          reason: string | null
          requested_at: string | null
          status: string | null
        }
        Insert: {
          approver_name?: string | null
          approver_role?: string | null
          contract_id: string
          decided_at?: string | null
          demo_batch?: string | null
          email?: string | null
          id?: string
          is_demo?: boolean | null
          reason?: string | null
          requested_at?: string | null
          status?: string | null
        }
        Update: {
          approver_name?: string | null
          approver_role?: string | null
          contract_id?: string
          decided_at?: string | null
          demo_batch?: string | null
          email?: string | null
          id?: string
          is_demo?: boolean | null
          reason?: string | null
          requested_at?: string | null
          status?: string | null
        }
        Relationships: []
      }
      exp_contract_documents: {
        Row: {
          auto_generated: boolean | null
          conditional_on: string | null
          content: Json | null
          contract_id: string
          created_at: string | null
          demo_batch: string | null
          doc_type: string
          file_url: string | null
          id: string
          is_demo: boolean | null
          rendered: boolean | null
          sort_order: number | null
          template_key: string | null
          title: string | null
          version: string | null
        }
        Insert: {
          auto_generated?: boolean | null
          conditional_on?: string | null
          content?: Json | null
          contract_id: string
          created_at?: string | null
          demo_batch?: string | null
          doc_type: string
          file_url?: string | null
          id?: string
          is_demo?: boolean | null
          rendered?: boolean | null
          sort_order?: number | null
          template_key?: string | null
          title?: string | null
          version?: string | null
        }
        Update: {
          auto_generated?: boolean | null
          conditional_on?: string | null
          content?: Json | null
          contract_id?: string
          created_at?: string | null
          demo_batch?: string | null
          doc_type?: string
          file_url?: string | null
          id?: string
          is_demo?: boolean | null
          rendered?: boolean | null
          sort_order?: number | null
          template_key?: string | null
          title?: string | null
          version?: string | null
        }
        Relationships: []
      }
      exp_contract_line_items: {
        Row: {
          allocation: number | null
          billing_mode: string | null
          contract_id: string | null
          cost: number | null
          description_snapshot: string | null
          discount_pct: number | null
          id: string
          is_base: boolean | null
          line_type: string | null
          margin_pct: number | null
          name_snapshot: string | null
          net: number | null
          notes: string | null
          overage_method: string | null
          overage_rate: number | null
          overage_unit: string | null
          product_code: string | null
          product_key: string | null
          qty: number | null
          scope: string | null
          subtotal: number | null
          term: string | null
          term_months: number | null
          unit_price: number | null
        }
        Insert: {
          allocation?: number | null
          billing_mode?: string | null
          contract_id?: string | null
          cost?: number | null
          description_snapshot?: string | null
          discount_pct?: number | null
          id?: string
          is_base?: boolean | null
          line_type?: string | null
          margin_pct?: number | null
          name_snapshot?: string | null
          net?: number | null
          notes?: string | null
          overage_method?: string | null
          overage_rate?: number | null
          overage_unit?: string | null
          product_code?: string | null
          product_key?: string | null
          qty?: number | null
          scope?: string | null
          subtotal?: number | null
          term?: string | null
          term_months?: number | null
          unit_price?: number | null
        }
        Update: {
          allocation?: number | null
          billing_mode?: string | null
          contract_id?: string | null
          cost?: number | null
          description_snapshot?: string | null
          discount_pct?: number | null
          id?: string
          is_base?: boolean | null
          line_type?: string | null
          margin_pct?: number | null
          name_snapshot?: string | null
          net?: number | null
          notes?: string | null
          overage_method?: string | null
          overage_rate?: number | null
          overage_unit?: string | null
          product_code?: string | null
          product_key?: string | null
          qty?: number | null
          scope?: string | null
          subtotal?: number | null
          term?: string | null
          term_months?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_contract_line_items_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "exp_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_contract_recipients: {
        Row: {
          contract_id: string
          created_at: string | null
          demo_batch: string | null
          email: string | null
          id: string
          is_demo: boolean | null
          party: string
          permissions: Json | null
          person_name: string | null
          role: string
          signing_order: number | null
        }
        Insert: {
          contract_id: string
          created_at?: string | null
          demo_batch?: string | null
          email?: string | null
          id?: string
          is_demo?: boolean | null
          party: string
          permissions?: Json | null
          person_name?: string | null
          role: string
          signing_order?: number | null
        }
        Update: {
          contract_id?: string
          created_at?: string | null
          demo_batch?: string | null
          email?: string | null
          id?: string
          is_demo?: boolean | null
          party?: string
          permissions?: Json | null
          person_name?: string | null
          role?: string
          signing_order?: number | null
        }
        Relationships: []
      }
      exp_contract_renewals: {
        Row: {
          contract_id: string | null
          current_acv: number | null
          demo_batch: string | null
          expansion_est: number | null
          id: string
          is_demo: boolean | null
          nonrenewal_notice_at: string | null
          notes: string | null
          notice_deadline: string | null
          owner: string | null
          reminder_state: string | null
          renewal_contract_id: string | null
          renewal_date: string | null
          renewal_decision: string
          status: string | null
          utilization_pct: number | null
        }
        Insert: {
          contract_id?: string | null
          current_acv?: number | null
          demo_batch?: string | null
          expansion_est?: number | null
          id?: string
          is_demo?: boolean | null
          nonrenewal_notice_at?: string | null
          notes?: string | null
          notice_deadline?: string | null
          owner?: string | null
          reminder_state?: string | null
          renewal_contract_id?: string | null
          renewal_date?: string | null
          renewal_decision?: string
          status?: string | null
          utilization_pct?: number | null
        }
        Update: {
          contract_id?: string | null
          current_acv?: number | null
          demo_batch?: string | null
          expansion_est?: number | null
          id?: string
          is_demo?: boolean | null
          nonrenewal_notice_at?: string | null
          notes?: string | null
          notice_deadline?: string | null
          owner?: string | null
          reminder_state?: string | null
          renewal_contract_id?: string | null
          renewal_date?: string | null
          renewal_decision?: string
          status?: string | null
          utilization_pct?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_contract_renewals_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "exp_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_contract_signatures: {
        Row: {
          consent_at: string | null
          contract_id: string | null
          declined_reason: string | null
          demo_batch: string | null
          id: string
          identity_method: string | null
          is_demo: boolean | null
          party: string | null
          role: string | null
          sent_at: string | null
          signature_data: string | null
          signature_type: string | null
          signed_at: string | null
          signed_ip: string | null
          signer_email: string | null
          signer_name: string | null
          signing_order: number | null
          status: string | null
          token: string | null
          user_agent: string | null
          version_hash: string | null
          version_no: number | null
        }
        Insert: {
          consent_at?: string | null
          contract_id?: string | null
          declined_reason?: string | null
          demo_batch?: string | null
          id?: string
          identity_method?: string | null
          is_demo?: boolean | null
          party?: string | null
          role?: string | null
          sent_at?: string | null
          signature_data?: string | null
          signature_type?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signer_email?: string | null
          signer_name?: string | null
          signing_order?: number | null
          status?: string | null
          token?: string | null
          user_agent?: string | null
          version_hash?: string | null
          version_no?: number | null
        }
        Update: {
          consent_at?: string | null
          contract_id?: string | null
          declined_reason?: string | null
          demo_batch?: string | null
          id?: string
          identity_method?: string | null
          is_demo?: boolean | null
          party?: string | null
          role?: string | null
          sent_at?: string | null
          signature_data?: string | null
          signature_type?: string | null
          signed_at?: string | null
          signed_ip?: string | null
          signer_email?: string | null
          signer_name?: string | null
          signing_order?: number | null
          status?: string | null
          token?: string | null
          user_agent?: string | null
          version_hash?: string | null
          version_no?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_contract_signatures_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "exp_contracts"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_contract_versions: {
        Row: {
          approval_state: string | null
          change_summary: Json | null
          contract_id: string
          created_at: string | null
          demo_batch: string | null
          file_url: string | null
          id: string
          is_demo: boolean | null
          is_signing_copy: boolean | null
          kind: string | null
          label: string | null
          source: string | null
          uploaded_by: string | null
          version_no: number
        }
        Insert: {
          approval_state?: string | null
          change_summary?: Json | null
          contract_id: string
          created_at?: string | null
          demo_batch?: string | null
          file_url?: string | null
          id?: string
          is_demo?: boolean | null
          is_signing_copy?: boolean | null
          kind?: string | null
          label?: string | null
          source?: string | null
          uploaded_by?: string | null
          version_no: number
        }
        Update: {
          approval_state?: string | null
          change_summary?: Json | null
          contract_id?: string
          created_at?: string | null
          demo_batch?: string | null
          file_url?: string | null
          id?: string
          is_demo?: boolean | null
          is_signing_copy?: boolean | null
          kind?: string | null
          label?: string | null
          source?: string | null
          uploaded_by?: string | null
          version_no?: number
        }
        Relationships: []
      }
      exp_contracts: {
        Row: {
          account_id: string | null
          acv: number | null
          approval_note: string | null
          approval_state: string
          auto_renew: boolean | null
          billing_frequency: string | null
          billing_mode: string | null
          contract_number: string | null
          contract_type: string | null
          cost: number | null
          created_at: string | null
          created_by: string | null
          current_version: number | null
          demo_batch: string | null
          document_hash: string | null
          end_date: string | null
          executed_at: string | null
          expiration_at: string | null
          id: string
          is_demo: boolean | null
          is_locked: boolean | null
          margin_pct: number | null
          master_agreement_url: string | null
          master_agreement_version: string | null
          mrr: number | null
          name: string
          net: number | null
          notice_deadline: string | null
          notice_period_days: number | null
          opportunity_id: string | null
          org_id: string | null
          parent_contract_id: string | null
          payment_terms: string | null
          quote_id: string | null
          renewal_term_months: number | null
          renewal_uplift_pct: number | null
          signing_version: number | null
          sold_by: string | null
          special_terms: string | null
          stage: string | null
          start_date: string | null
          status: string
          terms: Json | null
          token_package: number | null
          total_one_time: number | null
          total_recurring: number | null
        }
        Insert: {
          account_id?: string | null
          acv?: number | null
          approval_note?: string | null
          approval_state?: string
          auto_renew?: boolean | null
          billing_frequency?: string | null
          billing_mode?: string | null
          contract_number?: string | null
          contract_type?: string | null
          cost?: number | null
          created_at?: string | null
          created_by?: string | null
          current_version?: number | null
          demo_batch?: string | null
          document_hash?: string | null
          end_date?: string | null
          executed_at?: string | null
          expiration_at?: string | null
          id?: string
          is_demo?: boolean | null
          is_locked?: boolean | null
          margin_pct?: number | null
          master_agreement_url?: string | null
          master_agreement_version?: string | null
          mrr?: number | null
          name: string
          net?: number | null
          notice_deadline?: string | null
          notice_period_days?: number | null
          opportunity_id?: string | null
          org_id?: string | null
          parent_contract_id?: string | null
          payment_terms?: string | null
          quote_id?: string | null
          renewal_term_months?: number | null
          renewal_uplift_pct?: number | null
          signing_version?: number | null
          sold_by?: string | null
          special_terms?: string | null
          stage?: string | null
          start_date?: string | null
          status?: string
          terms?: Json | null
          token_package?: number | null
          total_one_time?: number | null
          total_recurring?: number | null
        }
        Update: {
          account_id?: string | null
          acv?: number | null
          approval_note?: string | null
          approval_state?: string
          auto_renew?: boolean | null
          billing_frequency?: string | null
          billing_mode?: string | null
          contract_number?: string | null
          contract_type?: string | null
          cost?: number | null
          created_at?: string | null
          created_by?: string | null
          current_version?: number | null
          demo_batch?: string | null
          document_hash?: string | null
          end_date?: string | null
          executed_at?: string | null
          expiration_at?: string | null
          id?: string
          is_demo?: boolean | null
          is_locked?: boolean | null
          margin_pct?: number | null
          master_agreement_url?: string | null
          master_agreement_version?: string | null
          mrr?: number | null
          name?: string
          net?: number | null
          notice_deadline?: string | null
          notice_period_days?: number | null
          opportunity_id?: string | null
          org_id?: string | null
          parent_contract_id?: string | null
          payment_terms?: string | null
          quote_id?: string | null
          renewal_term_months?: number | null
          renewal_uplift_pct?: number | null
          signing_version?: number | null
          sold_by?: string | null
          special_terms?: string | null
          stage?: string | null
          start_date?: string | null
          status?: string
          terms?: Json | null
          token_package?: number | null
          total_one_time?: number | null
          total_recurring?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_contracts_sold_by_fkey"
            columns: ["sold_by"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_contracts_bak_m4: {
        Row: {
          account_id: string | null
          approval_note: string | null
          approval_state: string | null
          cost: number | null
          created_at: string | null
          created_by: string | null
          demo_batch: string | null
          end_date: string | null
          id: string | null
          is_demo: boolean | null
          margin_pct: number | null
          mrr: number | null
          name: string | null
          net: number | null
          org_id: string | null
          sold_by: string | null
          start_date: string | null
          status: string | null
          terms: Json | null
          token_package: number | null
        }
        Insert: {
          account_id?: string | null
          approval_note?: string | null
          approval_state?: string | null
          cost?: number | null
          created_at?: string | null
          created_by?: string | null
          demo_batch?: string | null
          end_date?: string | null
          id?: string | null
          is_demo?: boolean | null
          margin_pct?: number | null
          mrr?: number | null
          name?: string | null
          net?: number | null
          org_id?: string | null
          sold_by?: string | null
          start_date?: string | null
          status?: string | null
          terms?: Json | null
          token_package?: number | null
        }
        Update: {
          account_id?: string | null
          approval_note?: string | null
          approval_state?: string | null
          cost?: number | null
          created_at?: string | null
          created_by?: string | null
          demo_batch?: string | null
          end_date?: string | null
          id?: string | null
          is_demo?: boolean | null
          margin_pct?: number | null
          mrr?: number | null
          name?: string | null
          net?: number | null
          org_id?: string | null
          sold_by?: string | null
          start_date?: string | null
          status?: string | null
          terms?: Json | null
          token_package?: number | null
        }
        Relationships: []
      }
      exp_control_grants: {
        Row: {
          created_at: string
          id: string
          is_primary: boolean
          role: string
          scope_id: string
          scope_type: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          is_primary?: boolean
          role: string
          scope_id?: string
          scope_type?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          is_primary?: boolean
          role?: string
          scope_id?: string
          scope_type?: string
          user_id?: string
        }
        Relationships: []
      }
      exp_control_nodes: {
        Row: {
          created_at: string
          is_billing_container: boolean
          linked_entity_id: string | null
          name: string
          node_id: string
          node_type: string
          parent_id: string | null
          settings: Json
          status: string
        }
        Insert: {
          created_at?: string
          is_billing_container?: boolean
          linked_entity_id?: string | null
          name: string
          node_id?: string
          node_type: string
          parent_id?: string | null
          settings?: Json
          status?: string
        }
        Update: {
          created_at?: string
          is_billing_container?: boolean
          linked_entity_id?: string | null
          name?: string
          node_id?: string
          node_type?: string
          parent_id?: string | null
          settings?: Json
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_control_nodes_linked_entity_id_fkey"
            columns: ["linked_entity_id"]
            isOneToOne: false
            referencedRelation: "exp_entity"
            referencedColumns: ["entity_id"]
          },
          {
            foreignKeyName: "exp_control_nodes_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "exp_control_nodes"
            referencedColumns: ["node_id"]
          },
        ]
      }
      exp_cost_events: {
        Row: {
          amount: number | null
          bucket: string | null
          cost_type: string | null
          id: string
          occurred_at: string | null
          product_key: string | null
          subject_id: string | null
          subject_type: string | null
        }
        Insert: {
          amount?: number | null
          bucket?: string | null
          cost_type?: string | null
          id?: string
          occurred_at?: string | null
          product_key?: string | null
          subject_id?: string | null
          subject_type?: string | null
        }
        Update: {
          amount?: number | null
          bucket?: string | null
          cost_type?: string | null
          id?: string
          occurred_at?: string | null
          product_key?: string | null
          subject_id?: string | null
          subject_type?: string | null
        }
        Relationships: []
      }
      exp_csm_assignments: {
        Row: {
          active: boolean
          assigned_at: string
          assigned_by: string | null
          csm_email: string | null
          csm_name: string | null
          csm_user_ref: string | null
          id: string
          subject_id: string
          subject_type: string
        }
        Insert: {
          active?: boolean
          assigned_at?: string
          assigned_by?: string | null
          csm_email?: string | null
          csm_name?: string | null
          csm_user_ref?: string | null
          id?: string
          subject_id: string
          subject_type?: string
        }
        Update: {
          active?: boolean
          assigned_at?: string
          assigned_by?: string | null
          csm_email?: string | null
          csm_name?: string | null
          csm_user_ref?: string | null
          id?: string
          subject_id?: string
          subject_type?: string
        }
        Relationships: []
      }
      exp_curation_ledger: {
        Row: {
          action: string
          batch: string | null
          gcid: string | null
          id: number
          layer: string
          rationale: string
          ruled_by: string
          target: string | null
          ts: string
        }
        Insert: {
          action: string
          batch?: string | null
          gcid?: string | null
          id?: number
          layer: string
          rationale: string
          ruled_by?: string
          target?: string | null
          ts?: string
        }
        Update: {
          action?: string
          batch?: string | null
          gcid?: string | null
          id?: number
          layer?: string
          rationale?: string
          ruled_by?: string
          target?: string | null
          ts?: string
        }
        Relationships: []
      }
      exp_dev_config: {
        Row: {
          created_at: string | null
          digest_day: string | null
          digest_time: string | null
          due_day: string | null
          due_time: string | null
          from_email: string | null
          id: string
          provider: string | null
          reminder_day: string | null
          reminder_time: string | null
        }
        Insert: {
          created_at?: string | null
          digest_day?: string | null
          digest_time?: string | null
          due_day?: string | null
          due_time?: string | null
          from_email?: string | null
          id?: string
          provider?: string | null
          reminder_day?: string | null
          reminder_time?: string | null
        }
        Update: {
          created_at?: string | null
          digest_day?: string | null
          digest_time?: string | null
          due_day?: string | null
          due_time?: string | null
          from_email?: string | null
          id?: string
          provider?: string | null
          reminder_day?: string | null
          reminder_time?: string | null
        }
        Relationships: []
      }
      exp_dev_demo_days: {
        Row: {
          created_at: string | null
          demo_date: string
          id: string
          notes: string | null
          team_id: string | null
          title: string
        }
        Insert: {
          created_at?: string | null
          demo_date: string
          id?: string
          notes?: string | null
          team_id?: string | null
          title: string
        }
        Update: {
          created_at?: string | null
          demo_date?: string
          id?: string
          notes?: string | null
          team_id?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_dev_demo_days_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "exp_dev_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_dev_docs: {
        Row: {
          body: string | null
          created_at: string | null
          doc_type: string | null
          id: string
          storage_path: string | null
          team_id: string | null
          title: string
          updated_at: string | null
          updated_by: string | null
          url: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          doc_type?: string | null
          id?: string
          storage_path?: string | null
          team_id?: string | null
          title: string
          updated_at?: string | null
          updated_by?: string | null
          url?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          doc_type?: string | null
          id?: string
          storage_path?: string | null
          team_id?: string | null
          title?: string
          updated_at?: string | null
          updated_by?: string | null
          url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_dev_docs_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "exp_dev_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_dev_idea_votes: {
        Row: {
          created_at: string | null
          id: string
          idea_id: string | null
          voter: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          idea_id?: string | null
          voter: string
        }
        Update: {
          created_at?: string | null
          id?: string
          idea_id?: string | null
          voter?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_dev_idea_votes_idea_id_fkey"
            columns: ["idea_id"]
            isOneToOne: false
            referencedRelation: "exp_dev_ideas"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_dev_ideas: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          status: string | null
          submitted_by: string | null
          team_id: string | null
          title: string
          votes: number | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          status?: string | null
          submitted_by?: string | null
          team_id?: string | null
          title: string
          votes?: number | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          status?: string | null
          submitted_by?: string | null
          team_id?: string | null
          title?: string
          votes?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_dev_ideas_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "exp_dev_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_dev_launch: {
        Row: {
          created_at: string | null
          id: string
          launch_date: string
          phase: string
          program_start: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          launch_date: string
          phase: string
          program_start: string
        }
        Update: {
          created_at?: string | null
          id?: string
          launch_date?: string
          phase?: string
          program_start?: string
        }
        Relationships: []
      }
      exp_dev_members: {
        Row: {
          created_at: string | null
          email: string | null
          id: string
          is_demo: boolean | null
          is_lead: boolean | null
          name: string
          role: string
          team_id: string | null
        }
        Insert: {
          created_at?: string | null
          email?: string | null
          id?: string
          is_demo?: boolean | null
          is_lead?: boolean | null
          name: string
          role: string
          team_id?: string | null
        }
        Update: {
          created_at?: string | null
          email?: string | null
          id?: string
          is_demo?: boolean | null
          is_lead?: boolean | null
          name?: string
          role?: string
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_dev_members_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "exp_dev_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_dev_projects: {
        Row: {
          created_at: string | null
          deadline: string | null
          description: string | null
          id: string
          name: string
          priority: string | null
          progress_pct: number | null
          status: string | null
          success_criteria: string | null
          team_id: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          name: string
          priority?: string | null
          progress_pct?: number | null
          status?: string | null
          success_criteria?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          deadline?: string | null
          description?: string | null
          id?: string
          name?: string
          priority?: string | null
          progress_pct?: number | null
          status?: string | null
          success_criteria?: string | null
          team_id?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_dev_projects_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "exp_dev_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_dev_sprint_items: {
        Row: {
          assignee: string | null
          canon_ref: string | null
          created_at: string | null
          deep_instructions: string | null
          id: string
          is_gate: boolean | null
          order_no: number | null
          priority: string | null
          project_id: string | null
          sprint_id: string | null
          status: string | null
          title: string
        }
        Insert: {
          assignee?: string | null
          canon_ref?: string | null
          created_at?: string | null
          deep_instructions?: string | null
          id?: string
          is_gate?: boolean | null
          order_no?: number | null
          priority?: string | null
          project_id?: string | null
          sprint_id?: string | null
          status?: string | null
          title: string
        }
        Update: {
          assignee?: string | null
          canon_ref?: string | null
          created_at?: string | null
          deep_instructions?: string | null
          id?: string
          is_gate?: boolean | null
          order_no?: number | null
          priority?: string | null
          project_id?: string | null
          sprint_id?: string | null
          status?: string | null
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_dev_sprint_items_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "exp_dev_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_dev_sprint_items_sprint_id_fkey"
            columns: ["sprint_id"]
            isOneToOne: false
            referencedRelation: "exp_dev_sprints"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_dev_sprints: {
        Row: {
          created_at: string | null
          end_date: string | null
          goal: string | null
          id: string
          name: string
          start_date: string | null
          team_id: string | null
        }
        Insert: {
          created_at?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          name: string
          start_date?: string | null
          team_id?: string | null
        }
        Update: {
          created_at?: string | null
          end_date?: string | null
          goal?: string | null
          id?: string
          name?: string
          start_date?: string | null
          team_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_dev_sprints_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "exp_dev_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_dev_teams: {
        Row: {
          created_at: string | null
          id: string
          lane: string
          leader: string | null
          name: string
          sort_order: number | null
          target_size: number | null
          team_type: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          lane: string
          leader?: string | null
          name: string
          sort_order?: number | null
          target_size?: number | null
          team_type: string
        }
        Update: {
          created_at?: string | null
          id?: string
          lane?: string
          leader?: string | null
          name?: string
          sort_order?: number | null
          target_size?: number | null
          team_type?: string
        }
        Relationships: []
      }
      exp_dev_weekly_updates: {
        Row: {
          blockers: string | null
          created_at: string | null
          highlights: string | null
          id: string
          member_id: string | null
          next_week: string | null
          self_progress_pct: number | null
          status: string | null
          submitted_at: string | null
          team_id: string | null
          week_start: string
        }
        Insert: {
          blockers?: string | null
          created_at?: string | null
          highlights?: string | null
          id?: string
          member_id?: string | null
          next_week?: string | null
          self_progress_pct?: number | null
          status?: string | null
          submitted_at?: string | null
          team_id?: string | null
          week_start: string
        }
        Update: {
          blockers?: string | null
          created_at?: string | null
          highlights?: string | null
          id?: string
          member_id?: string | null
          next_week?: string | null
          self_progress_pct?: number | null
          status?: string | null
          submitted_at?: string | null
          team_id?: string | null
          week_start?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_dev_weekly_updates_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "exp_dev_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_dev_weekly_updates_team_id_fkey"
            columns: ["team_id"]
            isOneToOne: false
            referencedRelation: "exp_dev_teams"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_directory_packs: {
        Row: {
          canonical_domain: string | null
          connection_method: string
          created_at: string
          directory_key: string
          directory_name: string
          directory_scope: string
          field: string | null
          is_active: boolean
          notes: string | null
          pack_family: string
          schema_property: string
          schema_type: string
          scope_confirmed_at: string | null
          scope_confirmed_by: string | null
          tier: number
          updated_at: string
          url_pattern: string | null
          verification_status: string
        }
        Insert: {
          canonical_domain?: string | null
          connection_method?: string
          created_at?: string
          directory_key: string
          directory_name: string
          directory_scope?: string
          field?: string | null
          is_active?: boolean
          notes?: string | null
          pack_family?: string
          schema_property?: string
          schema_type?: string
          scope_confirmed_at?: string | null
          scope_confirmed_by?: string | null
          tier?: number
          updated_at?: string
          url_pattern?: string | null
          verification_status?: string
        }
        Update: {
          canonical_domain?: string | null
          connection_method?: string
          created_at?: string
          directory_key?: string
          directory_name?: string
          directory_scope?: string
          field?: string | null
          is_active?: boolean
          notes?: string | null
          pack_family?: string
          schema_property?: string
          schema_type?: string
          scope_confirmed_at?: string | null
          scope_confirmed_by?: string | null
          tier?: number
          updated_at?: string
          url_pattern?: string | null
          verification_status?: string
        }
        Relationships: []
      }
      exp_doc_template: {
        Row: {
          active: boolean | null
          body: Json | null
          created_at: string | null
          key: string
          kind: string
          merge_fields: Json | null
          title: string | null
          version: string | null
        }
        Insert: {
          active?: boolean | null
          body?: Json | null
          created_at?: string | null
          key: string
          kind: string
          merge_fields?: Json | null
          title?: string | null
          version?: string | null
        }
        Update: {
          active?: boolean | null
          body?: Json | null
          created_at?: string | null
          key?: string
          kind?: string
          merge_fields?: Json | null
          title?: string | null
          version?: string | null
        }
        Relationships: []
      }
      exp_email_outbox: {
        Row: {
          alert_id: string | null
          body: string
          created_at: string
          created_by: string | null
          demo_batch: string | null
          error: string | null
          from_address: string | null
          id: string
          is_demo: boolean
          kind: string
          opportunity_id: string | null
          provider_message_id: string | null
          sent_at: string | null
          status: string
          subject: string
          task_id: string | null
          to_addresses: string[]
        }
        Insert: {
          alert_id?: string | null
          body: string
          created_at?: string
          created_by?: string | null
          demo_batch?: string | null
          error?: string | null
          from_address?: string | null
          id?: string
          is_demo?: boolean
          kind?: string
          opportunity_id?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          subject: string
          task_id?: string | null
          to_addresses?: string[]
        }
        Update: {
          alert_id?: string | null
          body?: string
          created_at?: string
          created_by?: string | null
          demo_batch?: string | null
          error?: string | null
          from_address?: string | null
          id?: string
          is_demo?: boolean
          kind?: string
          opportunity_id?: string | null
          provider_message_id?: string | null
          sent_at?: string | null
          status?: string
          subject?: string
          task_id?: string | null
          to_addresses?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "exp_email_outbox_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_pipeline"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_email_outbox_task_id_fkey"
            columns: ["task_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_tasks"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_engine_payloads: {
        Row: {
          gcid: string
          payload: Json | null
          received_at: string | null
        }
        Insert: {
          gcid: string
          payload?: Json | null
          received_at?: string | null
        }
        Update: {
          gcid?: string
          payload?: Json | null
          received_at?: string | null
        }
        Relationships: []
      }
      exp_engine_prompts: {
        Row: {
          prompt_key: string
          template: string
          updated_at: string | null
          version: number
        }
        Insert: {
          prompt_key: string
          template: string
          updated_at?: string | null
          version?: number
        }
        Update: {
          prompt_key?: string
          template?: string
          updated_at?: string | null
          version?: number
        }
        Relationships: []
      }
      exp_engine_requests: {
        Row: {
          created_at: string | null
          gcid: string
          purpose: string
          request_id: number
        }
        Insert: {
          created_at?: string | null
          gcid: string
          purpose: string
          request_id: number
        }
        Update: {
          created_at?: string | null
          gcid?: string
          purpose?: string
          request_id?: number
        }
        Relationships: []
      }
      exp_engine_snapshots: {
        Row: {
          created_at: string | null
          gcid: string
          id: number
          layer: string
          payload: Json
        }
        Insert: {
          created_at?: string | null
          gcid: string
          id?: number
          layer: string
          payload: Json
        }
        Update: {
          created_at?: string | null
          gcid?: string
          id?: number
          layer?: string
          payload?: Json
        }
        Relationships: []
      }
      exp_engine_vault: {
        Row: {
          active: boolean | null
          anthropic_key: string | null
          budget_daily_usd: number | null
          budget_total_usd: number | null
          id: number
          spend_day: string | null
          spent_today_usd: number | null
          spent_total_usd: number | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          anthropic_key?: string | null
          budget_daily_usd?: number | null
          budget_total_usd?: number | null
          id?: number
          spend_day?: string | null
          spent_today_usd?: number | null
          spent_total_usd?: number | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          anthropic_key?: string | null
          budget_daily_usd?: number | null
          budget_total_usd?: number | null
          id?: number
          spend_day?: string | null
          spent_today_usd?: number | null
          spent_total_usd?: number | null
          updated_at?: string | null
        }
        Relationships: []
      }
      exp_enrich_state: {
        Row: {
          attempts: number
          checked_at: string | null
          contract: string
          gcid: string
          last_error: string | null
          stage: string
          updated_at: string | null
          wave: number | null
        }
        Insert: {
          attempts?: number
          checked_at?: string | null
          contract?: string
          gcid: string
          last_error?: string | null
          stage?: string
          updated_at?: string | null
          wave?: number | null
        }
        Update: {
          attempts?: number
          checked_at?: string | null
          contract?: string
          gcid?: string
          last_error?: string | null
          stage?: string
          updated_at?: string | null
          wave?: number | null
        }
        Relationships: []
      }
      exp_entitlement: {
        Row: {
          allocation_pool_id: string | null
          billing_scope: string | null
          created_at: string
          entitlement_id: string
          entity_id: string
          management_scope: string | null
          payer_ref: string | null
          product: string
          provisioned_by: string | null
          status: string
          usage_current: Json
          usage_limits: Json
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          allocation_pool_id?: string | null
          billing_scope?: string | null
          created_at?: string
          entitlement_id?: string
          entity_id: string
          management_scope?: string | null
          payer_ref?: string | null
          product: string
          provisioned_by?: string | null
          status?: string
          usage_current?: Json
          usage_limits?: Json
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          allocation_pool_id?: string | null
          billing_scope?: string | null
          created_at?: string
          entitlement_id?: string
          entity_id?: string
          management_scope?: string | null
          payer_ref?: string | null
          product?: string
          provisioned_by?: string | null
          status?: string
          usage_current?: Json
          usage_limits?: Json
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_entitlement_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "exp_entity"
            referencedColumns: ["entity_id"]
          },
        ]
      }
      exp_entitlement_pools: {
        Row: {
          allocated: number
          created_at: string
          owner_ref: string
          payer_ref: string | null
          pool_id: string
          product: string
          quantity: number
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          allocated?: number
          created_at?: string
          owner_ref: string
          payer_ref?: string | null
          pool_id?: string
          product: string
          quantity: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          allocated?: number
          created_at?: string
          owner_ref?: string
          payer_ref?: string | null
          pool_id?: string
          product?: string
          quantity?: number
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      exp_entitlements: {
        Row: {
          config: Json | null
          expires_at: string | null
          granted_at: string | null
          granted_by: string | null
          id: string
          product_key: string
          source: string | null
          state: string
          subject_id: string
          subject_type: string
          tokens_included: number | null
        }
        Insert: {
          config?: Json | null
          expires_at?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          product_key: string
          source?: string | null
          state?: string
          subject_id: string
          subject_type: string
          tokens_included?: number | null
        }
        Update: {
          config?: Json | null
          expires_at?: string | null
          granted_at?: string | null
          granted_by?: string | null
          id?: string
          product_key?: string
          source?: string | null
          state?: string
          subject_id?: string
          subject_type?: string
          tokens_included?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_entitlements_product_key_fkey"
            columns: ["product_key"]
            isOneToOne: false
            referencedRelation: "exp_products"
            referencedColumns: ["product_key"]
          },
        ]
      }
      exp_entity: {
        Row: {
          attributes: Json
          claim_state: string
          confidence: number
          created_at: string
          display_name: string
          entity_id: string
          entity_type: string
          evidence: Json | null
          hydration: string
          identity_keys: Json
          is_demo: boolean
          last_observed_at: string | null
          last_verified_at: string | null
          merged_into: string | null
          removal_reason: string | null
          removed_at: string | null
          slug: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          attributes?: Json
          claim_state?: string
          confidence?: number
          created_at?: string
          display_name: string
          entity_id?: string
          entity_type: string
          evidence?: Json | null
          hydration?: string
          identity_keys?: Json
          is_demo?: boolean
          last_observed_at?: string | null
          last_verified_at?: string | null
          merged_into?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          slug?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          attributes?: Json
          claim_state?: string
          confidence?: number
          created_at?: string
          display_name?: string
          entity_id?: string
          entity_type?: string
          evidence?: Json | null
          hydration?: string
          identity_keys?: Json
          is_demo?: boolean
          last_observed_at?: string | null
          last_verified_at?: string | null
          merged_into?: string | null
          removal_reason?: string | null
          removed_at?: string | null
          slug?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_entity_merged_into_fkey"
            columns: ["merged_into"]
            isOneToOne: false
            referencedRelation: "exp_entity"
            referencedColumns: ["entity_id"]
          },
        ]
      }
      exp_entity_audit: {
        Row: {
          attempts: number | null
          batch: number | null
          confidence: number | null
          current_type: string | null
          display_name: string | null
          gcid: string
          pass1_confidence: number | null
          pass1_type: string | null
          proposed_type: string | null
          reason: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
          batch?: number | null
          confidence?: number | null
          current_type?: string | null
          display_name?: string | null
          gcid: string
          pass1_confidence?: number | null
          pass1_type?: string | null
          proposed_type?: string | null
          reason?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
          batch?: number | null
          confidence?: number | null
          current_type?: string | null
          display_name?: string | null
          gcid?: string
          pass1_confidence?: number | null
          pass1_type?: string | null
          proposed_type?: string | null
          reason?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      exp_etl_candidates: {
        Row: {
          candidate_id: string
          created_at: string | null
          first_source: string | null
          gcid: string
          nearest_existing: string | null
          normalized: string
          raw_value: string
          seen_count: number
          similarity: number | null
          status: string
          value_type: string
        }
        Insert: {
          candidate_id?: string
          created_at?: string | null
          first_source?: string | null
          gcid: string
          nearest_existing?: string | null
          normalized: string
          raw_value: string
          seen_count?: number
          similarity?: number | null
          status?: string
          value_type: string
        }
        Update: {
          candidate_id?: string
          created_at?: string | null
          first_source?: string | null
          gcid?: string
          nearest_existing?: string | null
          normalized?: string
          raw_value?: string
          seen_count?: number
          similarity?: number | null
          status?: string
          value_type?: string
        }
        Relationships: []
      }
      exp_etl_domains: {
        Row: {
          crawl_phase: string
          created_at: string | null
          domain: string
          global_daily_budget: number
          last_recon_at: string | null
          robots_status: string
          robots_summary: Json
          sitemap_url: string | null
        }
        Insert: {
          crawl_phase?: string
          created_at?: string | null
          domain: string
          global_daily_budget?: number
          last_recon_at?: string | null
          robots_status?: string
          robots_summary?: Json
          sitemap_url?: string | null
        }
        Update: {
          crawl_phase?: string
          created_at?: string | null
          domain?: string
          global_daily_budget?: number
          last_recon_at?: string | null
          robots_status?: string
          robots_summary?: Json
          sitemap_url?: string | null
        }
        Relationships: []
      }
      exp_etl_extract_queue: {
        Row: {
          attempts: number | null
          created_at: string | null
          eq_id: string
          frontier_id: string | null
          gcid: string | null
          page_kind: string | null
          page_text: string | null
          status: string
        }
        Insert: {
          attempts?: number | null
          created_at?: string | null
          eq_id?: string
          frontier_id?: string | null
          gcid?: string | null
          page_kind?: string | null
          page_text?: string | null
          status?: string
        }
        Update: {
          attempts?: number | null
          created_at?: string | null
          eq_id?: string
          frontier_id?: string | null
          gcid?: string | null
          page_kind?: string | null
          page_text?: string | null
          status?: string
        }
        Relationships: []
      }
      exp_etl_extract_requests: {
        Row: {
          created_at: string | null
          eq_id: string | null
          request_id: number
        }
        Insert: {
          created_at?: string | null
          eq_id?: string | null
          request_id: number
        }
        Update: {
          created_at?: string | null
          eq_id?: string | null
          request_id?: number
        }
        Relationships: []
      }
      exp_etl_fetch: {
        Row: {
          detail_url: string
          fetch_id: string
          http_status: number | null
          note: string | null
          parsed: boolean
          parsed_at: string | null
          request_id: number | null
          requested_at: string
          stage_id: string
        }
        Insert: {
          detail_url: string
          fetch_id?: string
          http_status?: number | null
          note?: string | null
          parsed?: boolean
          parsed_at?: string | null
          request_id?: number | null
          requested_at?: string
          stage_id: string
        }
        Update: {
          detail_url?: string
          fetch_id?: string
          http_status?: number | null
          note?: string | null
          parsed?: boolean
          parsed_at?: string | null
          request_id?: number | null
          requested_at?: string
          stage_id?: string
        }
        Relationships: []
      }
      exp_etl_fetch_requests: {
        Row: {
          created_at: string | null
          frontier_id: string | null
          request_id: number
        }
        Insert: {
          created_at?: string | null
          frontier_id?: string | null
          request_id: number
        }
        Update: {
          created_at?: string | null
          frontier_id?: string | null
          request_id?: number
        }
        Relationships: []
      }
      exp_etl_field_floors: {
        Row: {
          created_at: string
          gcid: string
          min_fields: number
          min_licenses: number
          min_products: number
          notes: string | null
          required_keys: string[]
          updated_at: string
        }
        Insert: {
          created_at?: string
          gcid: string
          min_fields?: number
          min_licenses?: number
          min_products?: number
          notes?: string | null
          required_keys?: string[]
          updated_at?: string
        }
        Update: {
          created_at?: string
          gcid?: string
          min_fields?: number
          min_licenses?: number
          min_products?: number
          notes?: string | null
          required_keys?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      exp_etl_field_health: {
        Row: {
          checked_at: string | null
          distinct_ratio: number | null
          field: string
          gcid: string
          modal_share: number | null
          modal_value: string | null
          sampled: number | null
          source_domain: string
          verdict: string | null
        }
        Insert: {
          checked_at?: string | null
          distinct_ratio?: number | null
          field: string
          gcid: string
          modal_share?: number | null
          modal_value?: string | null
          sampled?: number | null
          source_domain: string
          verdict?: string | null
        }
        Update: {
          checked_at?: string | null
          distinct_ratio?: number | null
          field?: string
          gcid?: string
          modal_share?: number | null
          modal_value?: string | null
          sampled?: number | null
          source_domain?: string
          verdict?: string | null
        }
        Relationships: []
      }
      exp_etl_frontier: {
        Row: {
          created_at: string | null
          domain: string
          fetched_at: string | null
          frontier_id: string
          kind: string
          priority: number
          status: string
          url: string
        }
        Insert: {
          created_at?: string | null
          domain: string
          fetched_at?: string | null
          frontier_id?: string
          kind: string
          priority?: number
          status?: string
          url: string
        }
        Update: {
          created_at?: string | null
          domain?: string
          fetched_at?: string | null
          frontier_id?: string
          kind?: string
          priority?: number
          status?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_etl_frontier_domain_fkey"
            columns: ["domain"]
            isOneToOne: false
            referencedRelation: "exp_etl_domains"
            referencedColumns: ["domain"]
          },
        ]
      }
      exp_etl_hydrate_jobs: {
        Row: {
          batch_size: number
          created_at: string
          failed: number
          gcid: string
          job_key: string
          last_error: string | null
          last_run_at: string | null
          lease_until: string | null
          processed: number
          promoted: number
          shallow: number
          status: string
          updated_at: string
        }
        Insert: {
          batch_size?: number
          created_at?: string
          failed?: number
          gcid: string
          job_key: string
          last_error?: string | null
          last_run_at?: string | null
          lease_until?: string | null
          processed?: number
          promoted?: number
          shallow?: number
          status?: string
          updated_at?: string
        }
        Update: {
          batch_size?: number
          created_at?: string
          failed?: number
          gcid?: string
          job_key?: string
          last_error?: string | null
          last_run_at?: string | null
          lease_until?: string | null
          processed?: number
          promoted?: number
          shallow?: number
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      exp_etl_jobs: {
        Row: {
          active: boolean
          created_at: string | null
          gcid: string
          job_id: string
          last_run_at: string | null
          model_role: string
          next_run_at: string | null
          phase: string
          report: Json
          schedule_cron: string | null
          stage: string
          status: string
          target_company_count: number | null
        }
        Insert: {
          active?: boolean
          created_at?: string | null
          gcid: string
          job_id?: string
          last_run_at?: string | null
          model_role?: string
          next_run_at?: string | null
          phase?: string
          report?: Json
          schedule_cron?: string | null
          stage?: string
          status?: string
          target_company_count?: number | null
        }
        Update: {
          active?: boolean
          created_at?: string | null
          gcid?: string
          job_id?: string
          last_run_at?: string | null
          model_role?: string
          next_run_at?: string | null
          phase?: string
          report?: Json
          schedule_cron?: string | null
          stage?: string
          status?: string
          target_company_count?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_etl_jobs_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_etl_jobs_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_etl_jobs_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_etl_jobs_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_etl_jobs_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_etl_jobs_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_etl_parsers: {
        Row: {
          gcid: string
          learned_at: string | null
          method: string
          parser_id: string
          parser_spec: Json
          sample_match_rate: number | null
          source_domain: string
          status: string
          version: number
        }
        Insert: {
          gcid: string
          learned_at?: string | null
          method: string
          parser_id?: string
          parser_spec: Json
          sample_match_rate?: number | null
          source_domain: string
          status?: string
          version?: number
        }
        Update: {
          gcid?: string
          learned_at?: string | null
          method?: string
          parser_id?: string
          parser_spec?: Json
          sample_match_rate?: number | null
          source_domain?: string
          status?: string
          version?: number
        }
        Relationships: []
      }
      exp_etl_recon_requests: {
        Row: {
          created_at: string | null
          kind: string | null
          request_id: number
          source_id: string | null
        }
        Insert: {
          created_at?: string | null
          kind?: string | null
          request_id: number
          source_id?: string | null
        }
        Update: {
          created_at?: string | null
          kind?: string | null
          request_id?: number
          source_id?: string | null
        }
        Relationships: []
      }
      exp_etl_runs: {
        Row: {
          conflicted: number | null
          created: number | null
          detail: Json | null
          entities_yielded: number | null
          errors: number | null
          finished_at: string | null
          matched: number | null
          pages_fetched: number | null
          pulled: number | null
          run_id: string
          source_id: string | null
          staged: number | null
          started_at: string | null
        }
        Insert: {
          conflicted?: number | null
          created?: number | null
          detail?: Json | null
          entities_yielded?: number | null
          errors?: number | null
          finished_at?: string | null
          matched?: number | null
          pages_fetched?: number | null
          pulled?: number | null
          run_id?: string
          source_id?: string | null
          staged?: number | null
          started_at?: string | null
        }
        Update: {
          conflicted?: number | null
          created?: number | null
          detail?: Json | null
          entities_yielded?: number | null
          errors?: number | null
          finished_at?: string | null
          matched?: number | null
          pages_fetched?: number | null
          pulled?: number | null
          run_id?: string
          source_id?: string | null
          staged?: number | null
          started_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_etl_runs_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "exp_etl_sources"
            referencedColumns: ["source_id"]
          },
        ]
      }
      exp_etl_source_contract: {
        Row: {
          created_at: string | null
          expected_fields: string[]
          gcid: string
          learned_from_url: string | null
          min_coverage: number
          required_fields: string[]
          sample_pass_threshold: number
          source_domain: string
        }
        Insert: {
          created_at?: string | null
          expected_fields: string[]
          gcid: string
          learned_from_url?: string | null
          min_coverage?: number
          required_fields: string[]
          sample_pass_threshold?: number
          source_domain: string
        }
        Update: {
          created_at?: string | null
          expected_fields?: string[]
          gcid?: string
          learned_from_url?: string | null
          min_coverage?: number
          required_fields?: string[]
          sample_pass_threshold?: number
          source_domain?: string
        }
        Relationships: []
      }
      exp_etl_sources: {
        Row: {
          access_method: string | null
          authority_rank: number
          crawl_method: string | null
          created_at: string | null
          daily_quota: number
          entity_types_available: string[]
          fetch_tier: string | null
          field_count: number | null
          field_coverage: Json
          freshness: string | null
          gcid: string
          hierarchy_sourceable: boolean
          insertable: boolean
          min_delay_seconds: number
          notes: string | null
          page_kinds: string[] | null
          probe: Json
          pull_window: string | null
          recon: Json
          robots_tos_status: string | null
          role_in_discovery: string | null
          source_domain: string
          source_id: string
          source_type: string
          status: string
          test_results: Json
        }
        Insert: {
          access_method?: string | null
          authority_rank?: number
          crawl_method?: string | null
          created_at?: string | null
          daily_quota?: number
          entity_types_available?: string[]
          fetch_tier?: string | null
          field_count?: number | null
          field_coverage?: Json
          freshness?: string | null
          gcid: string
          hierarchy_sourceable?: boolean
          insertable?: boolean
          min_delay_seconds?: number
          notes?: string | null
          page_kinds?: string[] | null
          probe?: Json
          pull_window?: string | null
          recon?: Json
          robots_tos_status?: string | null
          role_in_discovery?: string | null
          source_domain: string
          source_id?: string
          source_type: string
          status?: string
          test_results?: Json
        }
        Update: {
          access_method?: string | null
          authority_rank?: number
          crawl_method?: string | null
          created_at?: string | null
          daily_quota?: number
          entity_types_available?: string[]
          fetch_tier?: string | null
          field_count?: number | null
          field_coverage?: Json
          freshness?: string | null
          gcid?: string
          hierarchy_sourceable?: boolean
          insertable?: boolean
          min_delay_seconds?: number
          notes?: string | null
          page_kinds?: string[] | null
          probe?: Json
          pull_window?: string | null
          recon?: Json
          robots_tos_status?: string | null
          role_in_discovery?: string | null
          source_domain?: string
          source_id?: string
          source_type?: string
          status?: string
          test_results?: Json
        }
        Relationships: [
          {
            foreignKeyName: "exp_etl_sources_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_etl_sources_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_etl_sources_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_etl_sources_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_etl_sources_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_etl_sources_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_etl_staging: {
        Row: {
          detail_url: string | null
          entity_id: string | null
          entity_type: string
          field_tier: string
          gcid: string
          identity_candidates: Json
          observed_at: string
          payload: Json
          rejected_reason: string | null
          resolution_status: string
          resolved_at: string | null
          source_id: string | null
          stage_id: string
        }
        Insert: {
          detail_url?: string | null
          entity_id?: string | null
          entity_type: string
          field_tier?: string
          gcid: string
          identity_candidates?: Json
          observed_at?: string
          payload: Json
          rejected_reason?: string | null
          resolution_status?: string
          resolved_at?: string | null
          source_id?: string | null
          stage_id?: string
        }
        Update: {
          detail_url?: string | null
          entity_id?: string | null
          entity_type?: string
          field_tier?: string
          gcid?: string
          identity_candidates?: Json
          observed_at?: string
          payload?: Json
          rejected_reason?: string | null
          resolution_status?: string
          resolved_at?: string | null
          source_id?: string | null
          stage_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_etl_staging_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "exp_entity"
            referencedColumns: ["entity_id"]
          },
          {
            foreignKeyName: "exp_etl_staging_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "exp_etl_sources"
            referencedColumns: ["source_id"]
          },
        ]
      }
      exp_field_discovery: {
        Row: {
          created_at: string | null
          defined_at: string | null
          definition: string | null
          discovery_id: string
          element_kind: string
          examples: Json | null
          first_source: string | null
          gcid: string
          normalized: string
          proposed_ring: string | null
          proposed_schema_property: string | null
          raw_label: string
          reason: string | null
          registered_node_slug: string | null
          relevance_verdict: string | null
          seen_count: number | null
          status: string
          subject: string | null
          value_type: string | null
        }
        Insert: {
          created_at?: string | null
          defined_at?: string | null
          definition?: string | null
          discovery_id?: string
          element_kind: string
          examples?: Json | null
          first_source?: string | null
          gcid: string
          normalized: string
          proposed_ring?: string | null
          proposed_schema_property?: string | null
          raw_label: string
          reason?: string | null
          registered_node_slug?: string | null
          relevance_verdict?: string | null
          seen_count?: number | null
          status?: string
          subject?: string | null
          value_type?: string | null
        }
        Update: {
          created_at?: string | null
          defined_at?: string | null
          definition?: string | null
          discovery_id?: string
          element_kind?: string
          examples?: Json | null
          first_source?: string | null
          gcid?: string
          normalized?: string
          proposed_ring?: string | null
          proposed_schema_property?: string | null
          raw_label?: string
          reason?: string | null
          registered_node_slug?: string | null
          relevance_verdict?: string | null
          seen_count?: number | null
          status?: string
          subject?: string | null
          value_type?: string | null
        }
        Relationships: []
      }
      exp_gbp_attributes: {
        Row: {
          attribute_id: string
          deprecated: boolean | null
          display_name: string | null
          fetched_at: string
          gcid: string
          group_display_name: string | null
          repeatable: boolean | null
          value_options: Json | null
          value_type: string | null
        }
        Insert: {
          attribute_id: string
          deprecated?: boolean | null
          display_name?: string | null
          fetched_at?: string
          gcid: string
          group_display_name?: string | null
          repeatable?: boolean | null
          value_options?: Json | null
          value_type?: string | null
        }
        Update: {
          attribute_id?: string
          deprecated?: boolean | null
          display_name?: string | null
          fetched_at?: string
          gcid?: string
          group_display_name?: string | null
          repeatable?: boolean | null
          value_options?: Json | null
          value_type?: string | null
        }
        Relationships: []
      }
      exp_gbp_attributes_fetch_log: {
        Row: {
          attribute_count: number
          error: string | null
          fetched_at: string
          gcid: string
          status: string
        }
        Insert: {
          attribute_count?: number
          error?: string | null
          fetched_at?: string
          gcid: string
          status: string
        }
        Update: {
          attribute_count?: number
          error?: string | null
          fetched_at?: string
          gcid?: string
          status?: string
        }
        Relationships: []
      }
      exp_gbp_capture_attempts: {
        Row: {
          gcid: string
          n: number
        }
        Insert: {
          gcid: string
          n?: number
        }
        Update: {
          gcid?: string
          n?: number
        }
        Relationships: []
      }
      exp_gbp_capture_requests: {
        Row: {
          created_at: string | null
          gcid: string
          request_id: number
        }
        Insert: {
          created_at?: string | null
          gcid: string
          request_id: number
        }
        Update: {
          created_at?: string | null
          gcid?: string
          request_id?: number
        }
        Relationships: []
      }
      exp_gbp_capture_state: {
        Row: {
          active: boolean | null
          id: number
          last_error: string | null
          token: string | null
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          id?: number
          last_error?: string | null
          token?: string | null
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          id?: number
          last_error?: string | null
          token?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      exp_index_agent: {
        Row: {
          active: boolean | null
          built: number | null
          created_at: string | null
          discovered: number | null
          gcid: string | null
          held_shallow: number | null
          id: string
          indexed: number | null
          last_run_at: string | null
          phase: string | null
        }
        Insert: {
          active?: boolean | null
          built?: number | null
          created_at?: string | null
          discovered?: number | null
          gcid?: string | null
          held_shallow?: number | null
          id?: string
          indexed?: number | null
          last_run_at?: string | null
          phase?: string | null
        }
        Update: {
          active?: boolean | null
          built?: number | null
          created_at?: string | null
          discovered?: number | null
          gcid?: string | null
          held_shallow?: number | null
          id?: string
          indexed?: number | null
          last_run_at?: string | null
          phase?: string | null
        }
        Relationships: []
      }
      exp_index_config: {
        Row: {
          key: string
          updated_at: string
          value: string | null
        }
        Insert: {
          key: string
          updated_at?: string
          value?: string | null
        }
        Update: {
          key?: string
          updated_at?: string
          value?: string | null
        }
        Relationships: []
      }
      exp_index_queue: {
        Row: {
          completeness_floor: number | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          gcid: string | null
          id: string
          is_demo: boolean
          lastmod: string | null
          method: string | null
          score: number | null
          state: string | null
          submitted_at: string | null
          synced_at: string | null
          thoroughness_pct: number | null
          url: string | null
        }
        Insert: {
          completeness_floor?: number | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          gcid?: string | null
          id?: string
          is_demo?: boolean
          lastmod?: string | null
          method?: string | null
          score?: number | null
          state?: string | null
          submitted_at?: string | null
          synced_at?: string | null
          thoroughness_pct?: number | null
          url?: string | null
        }
        Update: {
          completeness_floor?: number | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          gcid?: string | null
          id?: string
          is_demo?: boolean
          lastmod?: string | null
          method?: string | null
          score?: number | null
          state?: string | null
          submitted_at?: string | null
          synced_at?: string | null
          thoroughness_pct?: number | null
          url?: string | null
        }
        Relationships: []
      }
      exp_index_submission_log: {
        Row: {
          event: string | null
          gcid: string | null
          http_status: number | null
          id: string
          is_demo: boolean | null
          method: string | null
          submitted_at: string | null
          url: string | null
        }
        Insert: {
          event?: string | null
          gcid?: string | null
          http_status?: number | null
          id?: string
          is_demo?: boolean | null
          method?: string | null
          submitted_at?: string | null
          url?: string | null
        }
        Update: {
          event?: string | null
          gcid?: string | null
          http_status?: number | null
          id?: string
          is_demo?: boolean | null
          method?: string | null
          submitted_at?: string | null
          url?: string | null
        }
        Relationships: []
      }
      exp_intake_contract: {
        Row: {
          capture_status: string | null
          contract_version: number | null
          element_key: string
          label: string
          metadata_keys: string[] | null
          naming_rule: string | null
          node_type: string
          notes: string | null
          ring_key: string
          ring_layer: string
          schema_property: string | null
          source_precedence: string[] | null
          storage_rule: string | null
          verification_rule: string | null
        }
        Insert: {
          capture_status?: string | null
          contract_version?: number | null
          element_key: string
          label: string
          metadata_keys?: string[] | null
          naming_rule?: string | null
          node_type: string
          notes?: string | null
          ring_key: string
          ring_layer: string
          schema_property?: string | null
          source_precedence?: string[] | null
          storage_rule?: string | null
          verification_rule?: string | null
        }
        Update: {
          capture_status?: string | null
          contract_version?: number | null
          element_key?: string
          label?: string
          metadata_keys?: string[] | null
          naming_rule?: string | null
          node_type?: string
          notes?: string | null
          ring_key?: string
          ring_layer?: string
          schema_property?: string | null
          source_precedence?: string[] | null
          storage_rule?: string | null
          verification_rule?: string | null
        }
        Relationships: []
      }
      exp_integration_google: {
        Row: {
          client_id_ref: string
          client_secret_ref: string
          connected_at: string | null
          connected_by: string | null
          connected_by_email: string | null
          delegation_mode: string
          domain: string
          domain_status: string
          domain_verification_token: string | null
          id: string
          last_error: string | null
          oauth_state: string | null
          oauth_state_expires_at: string | null
          refresh_token_vault_id: string | null
          requested_scopes: string[]
          scopes: string[]
          service_account_ref: string
          status: string
          updated_at: string
          verified_at: string | null
        }
        Insert: {
          client_id_ref?: string
          client_secret_ref?: string
          connected_at?: string | null
          connected_by?: string | null
          connected_by_email?: string | null
          delegation_mode?: string
          domain?: string
          domain_status?: string
          domain_verification_token?: string | null
          id?: string
          last_error?: string | null
          oauth_state?: string | null
          oauth_state_expires_at?: string | null
          refresh_token_vault_id?: string | null
          requested_scopes?: string[]
          scopes?: string[]
          service_account_ref?: string
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Update: {
          client_id_ref?: string
          client_secret_ref?: string
          connected_at?: string | null
          connected_by?: string | null
          connected_by_email?: string | null
          delegation_mode?: string
          domain?: string
          domain_status?: string
          domain_verification_token?: string | null
          id?: string
          last_error?: string | null
          oauth_state?: string | null
          oauth_state_expires_at?: string | null
          refresh_token_vault_id?: string | null
          requested_scopes?: string[]
          scopes?: string[]
          service_account_ref?: string
          status?: string
          updated_at?: string
          verified_at?: string | null
        }
        Relationships: []
      }
      exp_integration_settings: {
        Row: {
          key: string
          mode: string
          secret_refs: Json
          settings: Json
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          key: string
          mode?: string
          secret_refs?: Json
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          key?: string
          mode?: string
          secret_refs?: Json
          settings?: Json
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
      }
      exp_internal_assignments: {
        Row: {
          assignment_id: string
          created_at: string
          employee_user_id: string
          internal_role: string
          purpose: string | null
          scope_id: string
          scope_type: string
          valid_from: string | null
          valid_to: string | null
        }
        Insert: {
          assignment_id?: string
          created_at?: string
          employee_user_id: string
          internal_role: string
          purpose?: string | null
          scope_id: string
          scope_type: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Update: {
          assignment_id?: string
          created_at?: string
          employee_user_id?: string
          internal_role?: string
          purpose?: string | null
          scope_id?: string
          scope_type?: string
          valid_from?: string | null
          valid_to?: string | null
        }
        Relationships: []
      }
      exp_invoice: {
        Row: {
          billing_contact_email: string | null
          contract_id: string
          created_at: string | null
          currency: string | null
          demo_batch: string | null
          due_at: string | null
          id: string
          invoice_type: string
          is_demo: boolean | null
          issued_at: string | null
          number: string | null
          period_end: string | null
          period_start: string | null
          status: string | null
          subtotal: number | null
          total: number | null
        }
        Insert: {
          billing_contact_email?: string | null
          contract_id: string
          created_at?: string | null
          currency?: string | null
          demo_batch?: string | null
          due_at?: string | null
          id?: string
          invoice_type: string
          is_demo?: boolean | null
          issued_at?: string | null
          number?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string | null
          subtotal?: number | null
          total?: number | null
        }
        Update: {
          billing_contact_email?: string | null
          contract_id?: string
          created_at?: string | null
          currency?: string | null
          demo_batch?: string | null
          due_at?: string | null
          id?: string
          invoice_type?: string
          is_demo?: boolean | null
          issued_at?: string | null
          number?: string | null
          period_end?: string | null
          period_start?: string | null
          status?: string | null
          subtotal?: number | null
          total?: number | null
        }
        Relationships: []
      }
      exp_invoice_line: {
        Row: {
          amount: number | null
          description: string | null
          id: string
          invoice_id: string
          product_code: string | null
          qty: number | null
          unit: string | null
          unit_price: number | null
        }
        Insert: {
          amount?: number | null
          description?: string | null
          id?: string
          invoice_id: string
          product_code?: string | null
          qty?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Update: {
          amount?: number | null
          description?: string | null
          id?: string
          invoice_id?: string
          product_code?: string | null
          qty?: number | null
          unit?: string | null
          unit_price?: number | null
        }
        Relationships: []
      }
      exp_lane_audit: {
        Row: {
          gcid: string | null
          loc_n: number | null
          loc_only: number | null
          pro_n: number | null
          pro_only: number | null
          ring: string | null
          shared_n: number | null
        }
        Insert: {
          gcid?: string | null
          loc_n?: number | null
          loc_only?: number | null
          pro_n?: number | null
          pro_only?: number | null
          ring?: string | null
          shared_n?: number | null
        }
        Update: {
          gcid?: string | null
          loc_n?: number | null
          loc_only?: number | null
          pro_n?: number | null
          pro_only?: number | null
          ring?: string | null
          shared_n?: number | null
        }
        Relationships: []
      }
      exp_lane_audit_proj: {
        Row: {
          gcid: string | null
          proj_has_pro: boolean | null
        }
        Insert: {
          gcid?: string | null
          proj_has_pro?: boolean | null
        }
        Update: {
          gcid?: string | null
          proj_has_pro?: boolean | null
        }
        Relationships: []
      }
      exp_lead_routing_state: {
        Row: {
          gcid: string | null
          group_key: string | null
          id: string
          last_assigned_at: string | null
          last_seller_id: string | null
          tier: string | null
        }
        Insert: {
          gcid?: string | null
          group_key?: string | null
          id?: string
          last_assigned_at?: string | null
          last_seller_id?: string | null
          tier?: string | null
        }
        Update: {
          gcid?: string | null
          group_key?: string | null
          id?: string
          last_assigned_at?: string | null
          last_seller_id?: string | null
          tier?: string | null
        }
        Relationships: []
      }
      exp_listings_category_status: {
        Row: {
          family: string
          gcid: string
          present: boolean
        }
        Insert: {
          family: string
          gcid: string
          present: boolean
        }
        Update: {
          family?: string
          gcid?: string
          present?: boolean
        }
        Relationships: []
      }
      exp_listings_crosswalk: {
        Row: {
          breadcrumb: string | null
          code: string
          confidence: string | null
          gcid: string
          label: string | null
          publisher_id: string
          verified: boolean
        }
        Insert: {
          breadcrumb?: string | null
          code: string
          confidence?: string | null
          gcid: string
          label?: string | null
          publisher_id: string
          verified?: boolean
        }
        Update: {
          breadcrumb?: string | null
          code?: string
          confidence?: string | null
          gcid?: string
          label?: string | null
          publisher_id?: string
          verified?: boolean
        }
        Relationships: []
      }
      exp_listings_field_map: {
        Row: {
          api_field_path: string | null
          applicability: string
          catalog_version: string | null
          id: number
          notes: string | null
          our_target: string
          publisher_id: string | null
          required: boolean | null
          rule_spec: Json | null
          rules: string | null
          section: string
          section_note: string | null
          sort: number
          status_default: string
          their_field: string
          variant_family: string | null
          writable: boolean | null
        }
        Insert: {
          api_field_path?: string | null
          applicability?: string
          catalog_version?: string | null
          id?: number
          notes?: string | null
          our_target: string
          publisher_id?: string | null
          required?: boolean | null
          rule_spec?: Json | null
          rules?: string | null
          section: string
          section_note?: string | null
          sort?: number
          status_default?: string
          their_field: string
          variant_family?: string | null
          writable?: boolean | null
        }
        Update: {
          api_field_path?: string | null
          applicability?: string
          catalog_version?: string | null
          id?: number
          notes?: string | null
          our_target?: string
          publisher_id?: string | null
          required?: boolean | null
          rule_spec?: Json | null
          rules?: string | null
          section?: string
          section_note?: string | null
          sort?: number
          status_default?: string
          their_field?: string
          variant_family?: string | null
          writable?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_listings_field_map_publisher_id_fkey"
            columns: ["publisher_id"]
            isOneToOne: false
            referencedRelation: "exp_listings_publishers"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_listings_overlays: {
        Row: {
          gcid: string
          overlay: string
        }
        Insert: {
          gcid: string
          overlay: string
        }
        Update: {
          gcid?: string
          overlay?: string
        }
        Relationships: []
      }
      exp_listings_publishers: {
        Row: {
          api_notes: string | null
          auth_model: string | null
          channel_role: string | null
          display_sort: number | null
          id: string
          kind: string
          name: string
          notes: string | null
          ops_notes: Json | null
          publishes_to: string | null
          read_path: string | null
          role_status: string
          sandbox: string | null
          subtitle: string | null
          write_path: string | null
        }
        Insert: {
          api_notes?: string | null
          auth_model?: string | null
          channel_role?: string | null
          display_sort?: number | null
          id: string
          kind: string
          name: string
          notes?: string | null
          ops_notes?: Json | null
          publishes_to?: string | null
          read_path?: string | null
          role_status?: string
          sandbox?: string | null
          subtitle?: string | null
          write_path?: string | null
        }
        Update: {
          api_notes?: string | null
          auth_model?: string | null
          channel_role?: string | null
          display_sort?: number | null
          id?: string
          kind?: string
          name?: string
          notes?: string | null
          ops_notes?: Json | null
          publishes_to?: string | null
          read_path?: string | null
          role_status?: string
          sandbox?: string | null
          subtitle?: string | null
          write_path?: string | null
        }
        Relationships: []
      }
      exp_method_probe: {
        Row: {
          created_at: string | null
          request_id: number
          source_id: string | null
        }
        Insert: {
          created_at?: string | null
          request_id: number
          source_id?: string | null
        }
        Update: {
          created_at?: string | null
          request_id?: number
          source_id?: string | null
        }
        Relationships: []
      }
      exp_model_alerts: {
        Row: {
          alert_id: string
          created_at: string | null
          detail: string | null
          evidence: Json | null
          gcid: string | null
          kind: string | null
          seen_count: number | null
          severity: string | null
          status: string
        }
        Insert: {
          alert_id?: string
          created_at?: string | null
          detail?: string | null
          evidence?: Json | null
          gcid?: string | null
          kind?: string | null
          seen_count?: number | null
          severity?: string | null
          status?: string
        }
        Update: {
          alert_id?: string
          created_at?: string | null
          detail?: string | null
          evidence?: Json | null
          gcid?: string | null
          kind?: string | null
          seen_count?: number | null
          severity?: string | null
          status?: string
        }
        Relationships: []
      }
      exp_nora_state: {
        Row: {
          category: string | null
          entity_ref: string
          entity_type: string
          is_demo: boolean
          market: string | null
          name: string | null
          state: Json
          title: string | null
          updated_at: string
        }
        Insert: {
          category?: string | null
          entity_ref: string
          entity_type?: string
          is_demo?: boolean
          market?: string | null
          name?: string | null
          state?: Json
          title?: string | null
          updated_at?: string
        }
        Update: {
          category?: string | null
          entity_ref?: string
          entity_type?: string
          is_demo?: boolean
          market?: string | null
          name?: string | null
          state?: Json
          title?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      exp_nora_weights: {
        Row: {
          key: string
          note: string | null
          weight: number
        }
        Insert: {
          key: string
          note?: string | null
          weight: number
        }
        Update: {
          key?: string
          note?: string | null
          weight?: number
        }
        Relationships: []
      }
      exp_notifications: {
        Row: {
          body: string | null
          created_at: string | null
          demo_batch: string | null
          entity_id: string | null
          entity_type: string | null
          id: string
          is_demo: boolean | null
          kind: string | null
          link: string | null
          read_at: string | null
          title: string | null
          user_ref: string | null
        }
        Insert: {
          body?: string | null
          created_at?: string | null
          demo_batch?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_demo?: boolean | null
          kind?: string | null
          link?: string | null
          read_at?: string | null
          title?: string | null
          user_ref?: string | null
        }
        Update: {
          body?: string | null
          created_at?: string | null
          demo_batch?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string
          is_demo?: boolean | null
          kind?: string | null
          link?: string | null
          read_at?: string | null
          title?: string | null
          user_ref?: string | null
        }
        Relationships: []
      }
      exp_opportunity_contacts: {
        Row: {
          champion_detail: Json | null
          contact_id: string | null
          created_at: string | null
          demo_batch: string | null
          id: string
          is_champion: boolean | null
          is_demo: boolean | null
          is_primary: boolean | null
          last_touch_at: string | null
          opportunity_id: string | null
          relationship_strength: number | null
          role: string | null
          source_origin: string | null
        }
        Insert: {
          champion_detail?: Json | null
          contact_id?: string | null
          created_at?: string | null
          demo_batch?: string | null
          id?: string
          is_champion?: boolean | null
          is_demo?: boolean | null
          is_primary?: boolean | null
          last_touch_at?: string | null
          opportunity_id?: string | null
          relationship_strength?: number | null
          role?: string | null
          source_origin?: string | null
        }
        Update: {
          champion_detail?: Json | null
          contact_id?: string | null
          created_at?: string | null
          demo_batch?: string | null
          id?: string
          is_champion?: boolean | null
          is_demo?: boolean | null
          is_primary?: boolean | null
          last_touch_at?: string | null
          opportunity_id?: string | null
          relationship_strength?: number | null
          role?: string | null
          source_origin?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_opportunity_contacts_contact_id_fkey"
            columns: ["contact_id"]
            isOneToOne: false
            referencedRelation: "exp_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_opportunity_contacts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_pipeline"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_opportunity_feedback: {
        Row: {
          actor: string | null
          created_at: string
          entity_id: string
          entity_type: string | null
          id: string
          note: string | null
          opportunity_key: string
          signal: string
          snooze_until: string | null
          weight: number
        }
        Insert: {
          actor?: string | null
          created_at?: string
          entity_id: string
          entity_type?: string | null
          id?: string
          note?: string | null
          opportunity_key: string
          signal: string
          snooze_until?: string | null
          weight?: number
        }
        Update: {
          actor?: string | null
          created_at?: string
          entity_id?: string
          entity_type?: string | null
          id?: string
          note?: string | null
          opportunity_key?: string
          signal?: string
          snooze_until?: string | null
          weight?: number
        }
        Relationships: []
      }
      exp_opportunity_files: {
        Row: {
          contract_id: string | null
          demo_batch: string | null
          filename: string | null
          id: string
          is_demo: boolean | null
          kind: string | null
          opportunity_id: string | null
          size_bytes: number | null
          storage_url: string | null
          uploaded_at: string | null
          uploaded_by: string | null
        }
        Insert: {
          contract_id?: string | null
          demo_batch?: string | null
          filename?: string | null
          id?: string
          is_demo?: boolean | null
          kind?: string | null
          opportunity_id?: string | null
          size_bytes?: number | null
          storage_url?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Update: {
          contract_id?: string | null
          demo_batch?: string | null
          filename?: string | null
          id?: string
          is_demo?: boolean | null
          kind?: string | null
          opportunity_id?: string | null
          size_bytes?: number | null
          storage_url?: string | null
          uploaded_at?: string | null
          uploaded_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_opportunity_files_contract_id_fkey"
            columns: ["contract_id"]
            isOneToOne: false
            referencedRelation: "exp_contracts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_opportunity_files_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_pipeline"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_opportunity_files_uploaded_by_fkey"
            columns: ["uploaded_by"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_opportunity_owner_history: {
        Row: {
          changed_at: string
          changed_by: string | null
          from_owner: string | null
          id: string
          opportunity_id: string | null
          to_owner: string | null
        }
        Insert: {
          changed_at?: string
          changed_by?: string | null
          from_owner?: string | null
          id?: string
          opportunity_id?: string | null
          to_owner?: string | null
        }
        Update: {
          changed_at?: string
          changed_by?: string | null
          from_owner?: string | null
          id?: string
          opportunity_id?: string | null
          to_owner?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_opportunity_owner_history_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_pipeline"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_opportunity_products: {
        Row: {
          amount: number | null
          demo_batch: string | null
          id: string
          is_demo: boolean | null
          opportunity_id: string | null
          product: string | null
          qty: number | null
          unit_price: number | null
        }
        Insert: {
          amount?: number | null
          demo_batch?: string | null
          id?: string
          is_demo?: boolean | null
          opportunity_id?: string | null
          product?: string | null
          qty?: number | null
          unit_price?: number | null
        }
        Update: {
          amount?: number | null
          demo_batch?: string | null
          id?: string
          is_demo?: boolean | null
          opportunity_id?: string | null
          product?: string | null
          qty?: number | null
          unit_price?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_opportunity_products_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_pipeline"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_opportunity_stage_history: {
        Row: {
          captured: Json | null
          demo_batch: string | null
          from_stage: string | null
          id: string
          is_demo: boolean | null
          moved_at: string | null
          moved_by: string | null
          moved_by_role: string | null
          moved_by_user: string | null
          opportunity_id: string | null
          to_stage: string | null
        }
        Insert: {
          captured?: Json | null
          demo_batch?: string | null
          from_stage?: string | null
          id?: string
          is_demo?: boolean | null
          moved_at?: string | null
          moved_by?: string | null
          moved_by_role?: string | null
          moved_by_user?: string | null
          opportunity_id?: string | null
          to_stage?: string | null
        }
        Update: {
          captured?: Json | null
          demo_batch?: string | null
          from_stage?: string | null
          id?: string
          is_demo?: boolean | null
          moved_at?: string | null
          moved_by?: string | null
          moved_by_role?: string | null
          moved_by_user?: string | null
          opportunity_id?: string | null
          to_stage?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_opportunity_stage_history_moved_by_fkey"
            columns: ["moved_by"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_opportunity_stage_history_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_pipeline"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_order_sku: {
        Row: {
          active: boolean | null
          annual_unit_price: number | null
          code: string
          created_at: string | null
          default_billing_mode: string | null
          edition: string | null
          exhibit_key: string | null
          family: string | null
          included_allocation: number | null
          included_credits: number | null
          is_base_package: boolean | null
          line_type: string | null
          min_charge_units: number | null
          monthly_unit_price: number | null
          name: string
          nora_product_key: string | null
          notes: string | null
          overage_method: string | null
          overage_rate_annual: number | null
          overage_rate_monthly: number | null
          overage_unit: string | null
          unit: string | null
        }
        Insert: {
          active?: boolean | null
          annual_unit_price?: number | null
          code: string
          created_at?: string | null
          default_billing_mode?: string | null
          edition?: string | null
          exhibit_key?: string | null
          family?: string | null
          included_allocation?: number | null
          included_credits?: number | null
          is_base_package?: boolean | null
          line_type?: string | null
          min_charge_units?: number | null
          monthly_unit_price?: number | null
          name: string
          nora_product_key?: string | null
          notes?: string | null
          overage_method?: string | null
          overage_rate_annual?: number | null
          overage_rate_monthly?: number | null
          overage_unit?: string | null
          unit?: string | null
        }
        Update: {
          active?: boolean | null
          annual_unit_price?: number | null
          code?: string
          created_at?: string | null
          default_billing_mode?: string | null
          edition?: string | null
          exhibit_key?: string | null
          family?: string | null
          included_allocation?: number | null
          included_credits?: number | null
          is_base_package?: boolean | null
          line_type?: string | null
          min_charge_units?: number | null
          monthly_unit_price?: number | null
          name?: string
          nora_product_key?: string | null
          notes?: string | null
          overage_method?: string | null
          overage_rate_annual?: number | null
          overage_rate_monthly?: number | null
          overage_unit?: string | null
          unit?: string | null
        }
        Relationships: []
      }
      exp_outbox: {
        Row: {
          body_html: string | null
          created_at: string | null
          demo_batch: string | null
          entity_id: string | null
          entity_type: string | null
          error: string | null
          id: string
          is_demo: boolean | null
          payload: Json | null
          provider: string | null
          provider_message_id: string | null
          scheduled_for: string | null
          sent_at: string | null
          status: string | null
          subject: string | null
          template: string | null
          to_email: string | null
          to_name: string | null
        }
        Insert: {
          body_html?: string | null
          created_at?: string | null
          demo_batch?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error?: string | null
          id?: string
          is_demo?: boolean | null
          payload?: Json | null
          provider?: string | null
          provider_message_id?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          subject?: string | null
          template?: string | null
          to_email?: string | null
          to_name?: string | null
        }
        Update: {
          body_html?: string | null
          created_at?: string | null
          demo_batch?: string | null
          entity_id?: string | null
          entity_type?: string | null
          error?: string | null
          id?: string
          is_demo?: boolean | null
          payload?: Json | null
          provider?: string | null
          provider_message_id?: string | null
          scheduled_for?: string | null
          sent_at?: string | null
          status?: string | null
          subject?: string | null
          template?: string | null
          to_email?: string | null
          to_name?: string | null
        }
        Relationships: []
      }
      exp_page_views_rollup: {
        Row: {
          claim_cta_views: number | null
          claims: number | null
          day: string | null
          gcid: string | null
          geo_type: string | null
          geo_value: string | null
          id: string
          is_demo: boolean | null
          page_views: number | null
          unique_visitors: number | null
        }
        Insert: {
          claim_cta_views?: number | null
          claims?: number | null
          day?: string | null
          gcid?: string | null
          geo_type?: string | null
          geo_value?: string | null
          id?: string
          is_demo?: boolean | null
          page_views?: number | null
          unique_visitors?: number | null
        }
        Update: {
          claim_cta_views?: number | null
          claims?: number | null
          day?: string | null
          gcid?: string | null
          geo_type?: string | null
          geo_value?: string | null
          id?: string
          is_demo?: boolean | null
          page_views?: number | null
          unique_visitors?: number | null
        }
        Relationships: []
      }
      exp_pagekit: {
        Row: {
          completeness_floor: number | null
          entity_type: string
          family: string
          hero_cta: string | null
          required_sections: Json | null
          sections: Json | null
        }
        Insert: {
          completeness_floor?: number | null
          entity_type: string
          family: string
          hero_cta?: string | null
          required_sections?: Json | null
          sections?: Json | null
        }
        Update: {
          completeness_floor?: number | null
          entity_type?: string
          family?: string
          hero_cta?: string | null
          required_sections?: Json | null
          sections?: Json | null
        }
        Relationships: []
      }
      exp_pipeline_stages: {
        Row: {
          is_open: boolean | null
          key: string
          label: string | null
          sort: number | null
        }
        Insert: {
          is_open?: boolean | null
          key: string
          label?: string | null
          sort?: number | null
        }
        Update: {
          is_open?: boolean | null
          key?: string
          label?: string | null
          sort?: number | null
        }
        Relationships: []
      }
      exp_price_book: {
        Row: {
          billing_type: string | null
          contract_price: number | null
          cost_type: string | null
          cost_value: number | null
          created_at: string | null
          credit_cost_per_unit: number | null
          description: string | null
          discount_tiers: Json | null
          floor_margin_pct: number | null
          id: string
          list_price: number | null
          notes: string | null
          product_key: string | null
          scope: string | null
          unit: string | null
        }
        Insert: {
          billing_type?: string | null
          contract_price?: number | null
          cost_type?: string | null
          cost_value?: number | null
          created_at?: string | null
          credit_cost_per_unit?: number | null
          description?: string | null
          discount_tiers?: Json | null
          floor_margin_pct?: number | null
          id?: string
          list_price?: number | null
          notes?: string | null
          product_key?: string | null
          scope?: string | null
          unit?: string | null
        }
        Update: {
          billing_type?: string | null
          contract_price?: number | null
          cost_type?: string | null
          cost_value?: number | null
          created_at?: string | null
          credit_cost_per_unit?: number | null
          description?: string | null
          discount_tiers?: Json | null
          floor_margin_pct?: number | null
          id?: string
          list_price?: number | null
          notes?: string | null
          product_key?: string | null
          scope?: string | null
          unit?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_price_book_product_key_fkey"
            columns: ["product_key"]
            isOneToOne: false
            referencedRelation: "exp_products"
            referencedColumns: ["product_key"]
          },
        ]
      }
      exp_price_book_bak_20261004: {
        Row: {
          billing_type: string | null
          contract_price: number | null
          cost_type: string | null
          cost_value: number | null
          created_at: string | null
          credit_cost_per_unit: number | null
          description: string | null
          discount_tiers: Json | null
          floor_margin_pct: number | null
          id: string | null
          list_price: number | null
          notes: string | null
          product_key: string | null
          scope: string | null
          unit: string | null
        }
        Insert: {
          billing_type?: string | null
          contract_price?: number | null
          cost_type?: string | null
          cost_value?: number | null
          created_at?: string | null
          credit_cost_per_unit?: number | null
          description?: string | null
          discount_tiers?: Json | null
          floor_margin_pct?: number | null
          id?: string | null
          list_price?: number | null
          notes?: string | null
          product_key?: string | null
          scope?: string | null
          unit?: string | null
        }
        Update: {
          billing_type?: string | null
          contract_price?: number | null
          cost_type?: string | null
          cost_value?: number | null
          created_at?: string | null
          credit_cost_per_unit?: number | null
          description?: string | null
          discount_tiers?: Json | null
          floor_margin_pct?: number | null
          id?: string | null
          list_price?: number | null
          notes?: string | null
          product_key?: string | null
          scope?: string | null
          unit?: string | null
        }
        Relationships: []
      }
      exp_price_tiers: {
        Row: {
          addl_user_monthly: number | null
          created_at: string | null
          demo_batch: string | null
          discount_pct: number | null
          effective_from: string | null
          entity_type: string | null
          id: string
          included_campaigns: number | null
          is_demo: boolean | null
          label: string | null
          list_per_user: number | null
          max_qty: number | null
          min_qty: number | null
          overage_rate: number | null
          platform_fee_annual: number | null
          pooled_credits: number | null
          product_key: string | null
          setup_fee: number | null
          sort: number | null
          tier_kind: string | null
          unit_price: number | null
          variant: string | null
        }
        Insert: {
          addl_user_monthly?: number | null
          created_at?: string | null
          demo_batch?: string | null
          discount_pct?: number | null
          effective_from?: string | null
          entity_type?: string | null
          id?: string
          included_campaigns?: number | null
          is_demo?: boolean | null
          label?: string | null
          list_per_user?: number | null
          max_qty?: number | null
          min_qty?: number | null
          overage_rate?: number | null
          platform_fee_annual?: number | null
          pooled_credits?: number | null
          product_key?: string | null
          setup_fee?: number | null
          sort?: number | null
          tier_kind?: string | null
          unit_price?: number | null
          variant?: string | null
        }
        Update: {
          addl_user_monthly?: number | null
          created_at?: string | null
          demo_batch?: string | null
          discount_pct?: number | null
          effective_from?: string | null
          entity_type?: string | null
          id?: string
          included_campaigns?: number | null
          is_demo?: boolean | null
          label?: string | null
          list_per_user?: number | null
          max_qty?: number | null
          min_qty?: number | null
          overage_rate?: number | null
          platform_fee_annual?: number | null
          pooled_credits?: number | null
          product_key?: string | null
          setup_fee?: number | null
          sort?: number | null
          tier_kind?: string | null
          unit_price?: number | null
          variant?: string | null
        }
        Relationships: []
      }
      exp_price_tiers_bak_20261004: {
        Row: {
          addl_user_monthly: number | null
          created_at: string | null
          demo_batch: string | null
          discount_pct: number | null
          effective_from: string | null
          entity_type: string | null
          id: string | null
          included_campaigns: number | null
          is_demo: boolean | null
          label: string | null
          list_per_user: number | null
          max_qty: number | null
          min_qty: number | null
          overage_rate: number | null
          platform_fee_annual: number | null
          pooled_credits: number | null
          product_key: string | null
          setup_fee: number | null
          sort: number | null
          tier_kind: string | null
          unit_price: number | null
          variant: string | null
        }
        Insert: {
          addl_user_monthly?: number | null
          created_at?: string | null
          demo_batch?: string | null
          discount_pct?: number | null
          effective_from?: string | null
          entity_type?: string | null
          id?: string | null
          included_campaigns?: number | null
          is_demo?: boolean | null
          label?: string | null
          list_per_user?: number | null
          max_qty?: number | null
          min_qty?: number | null
          overage_rate?: number | null
          platform_fee_annual?: number | null
          pooled_credits?: number | null
          product_key?: string | null
          setup_fee?: number | null
          sort?: number | null
          tier_kind?: string | null
          unit_price?: number | null
          variant?: string | null
        }
        Update: {
          addl_user_monthly?: number | null
          created_at?: string | null
          demo_batch?: string | null
          discount_pct?: number | null
          effective_from?: string | null
          entity_type?: string | null
          id?: string | null
          included_campaigns?: number | null
          is_demo?: boolean | null
          label?: string | null
          list_per_user?: number | null
          max_qty?: number | null
          min_qty?: number | null
          overage_rate?: number | null
          platform_fee_annual?: number | null
          pooled_credits?: number | null
          product_key?: string | null
          setup_fee?: number | null
          sort?: number | null
          tier_kind?: string | null
          unit_price?: number | null
          variant?: string | null
        }
        Relationships: []
      }
      exp_pricing_config: {
        Row: {
          key: string
          label: string | null
          unit: string | null
          updated_at: string | null
          value: number | null
          value_json: Json | null
        }
        Insert: {
          key: string
          label?: string | null
          unit?: string | null
          updated_at?: string | null
          value?: number | null
          value_json?: Json | null
        }
        Update: {
          key?: string
          label?: string | null
          unit?: string | null
          updated_at?: string | null
          value?: number | null
          value_json?: Json | null
        }
        Relationships: []
      }
      exp_product_naming_audit: {
        Row: {
          gcid: string | null
          servicephrase_terms: number | null
          total_products: number | null
        }
        Insert: {
          gcid?: string | null
          servicephrase_terms?: number | null
          total_products?: number | null
        }
        Update: {
          gcid?: string | null
          servicephrase_terms?: number | null
          total_products?: number | null
        }
        Relationships: []
      }
      exp_products: {
        Row: {
          active: boolean | null
          billing_type: string
          consumes_llm_credits: boolean | null
          created_at: string | null
          creditable: boolean | null
          description: string | null
          discountable: boolean | null
          entity_scope: string | null
          est_credits_per_location: number | null
          est_credits_per_professional: number | null
          is_addon: boolean | null
          lane: string | null
          min_charge: number | null
          name: string
          package_includes: Json | null
          passthrough: boolean | null
          price_monthly: number | null
          price_monthly_location: number | null
          price_unit: string | null
          product_key: string
          reconciled_at: string | null
          sort: number | null
        }
        Insert: {
          active?: boolean | null
          billing_type: string
          consumes_llm_credits?: boolean | null
          created_at?: string | null
          creditable?: boolean | null
          description?: string | null
          discountable?: boolean | null
          entity_scope?: string | null
          est_credits_per_location?: number | null
          est_credits_per_professional?: number | null
          is_addon?: boolean | null
          lane?: string | null
          min_charge?: number | null
          name: string
          package_includes?: Json | null
          passthrough?: boolean | null
          price_monthly?: number | null
          price_monthly_location?: number | null
          price_unit?: string | null
          product_key: string
          reconciled_at?: string | null
          sort?: number | null
        }
        Update: {
          active?: boolean | null
          billing_type?: string
          consumes_llm_credits?: boolean | null
          created_at?: string | null
          creditable?: boolean | null
          description?: string | null
          discountable?: boolean | null
          entity_scope?: string | null
          est_credits_per_location?: number | null
          est_credits_per_professional?: number | null
          is_addon?: boolean | null
          lane?: string | null
          min_charge?: number | null
          name?: string
          package_includes?: Json | null
          passthrough?: boolean | null
          price_monthly?: number | null
          price_monthly_location?: number | null
          price_unit?: string | null
          product_key?: string
          reconciled_at?: string | null
          sort?: number | null
        }
        Relationships: []
      }
      exp_products_bak_20261004: {
        Row: {
          active: boolean | null
          billing_type: string | null
          consumes_llm_credits: boolean | null
          created_at: string | null
          description: string | null
          entity_scope: string | null
          est_credits_per_location: number | null
          est_credits_per_professional: number | null
          is_addon: boolean | null
          name: string | null
          price_monthly: number | null
          price_monthly_location: number | null
          price_unit: string | null
          product_key: string | null
          sort: number | null
        }
        Insert: {
          active?: boolean | null
          billing_type?: string | null
          consumes_llm_credits?: boolean | null
          created_at?: string | null
          description?: string | null
          entity_scope?: string | null
          est_credits_per_location?: number | null
          est_credits_per_professional?: number | null
          is_addon?: boolean | null
          name?: string | null
          price_monthly?: number | null
          price_monthly_location?: number | null
          price_unit?: string | null
          product_key?: string | null
          sort?: number | null
        }
        Update: {
          active?: boolean | null
          billing_type?: string | null
          consumes_llm_credits?: boolean | null
          created_at?: string | null
          description?: string | null
          entity_scope?: string | null
          est_credits_per_location?: number | null
          est_credits_per_professional?: number | null
          is_addon?: boolean | null
          name?: string | null
          price_monthly?: number | null
          price_monthly_location?: number | null
          price_unit?: string | null
          product_key?: string | null
          sort?: number | null
        }
        Relationships: []
      }
      exp_profile_scores: {
        Row: {
          band: string | null
          components: Json | null
          computed_at: string | null
          config_version: string | null
          entity_id: string | null
          entity_type: string | null
          gcid: string | null
          id: string
          score: number | null
        }
        Insert: {
          band?: string | null
          components?: Json | null
          computed_at?: string | null
          config_version?: string | null
          entity_id?: string | null
          entity_type?: string | null
          gcid?: string | null
          id?: string
          score?: number | null
        }
        Update: {
          band?: string | null
          components?: Json | null
          computed_at?: string | null
          config_version?: string | null
          entity_id?: string | null
          entity_type?: string | null
          gcid?: string | null
          id?: string
          score?: number | null
        }
        Relationships: []
      }
      exp_promo_codes: {
        Row: {
          active: boolean | null
          amount: number | null
          applies_to_products: string[] | null
          applies_to_scope: string | null
          code: string | null
          created_at: string | null
          demo_batch: string | null
          discount_kind: string | null
          discount_pct: number | null
          duration_months: number | null
          expires_at: string | null
          id: string
          is_demo: boolean | null
          pricing_type: string | null
          scope_type: string | null
          seller_id: string | null
          starts_at: string | null
        }
        Insert: {
          active?: boolean | null
          amount?: number | null
          applies_to_products?: string[] | null
          applies_to_scope?: string | null
          code?: string | null
          created_at?: string | null
          demo_batch?: string | null
          discount_kind?: string | null
          discount_pct?: number | null
          duration_months?: number | null
          expires_at?: string | null
          id?: string
          is_demo?: boolean | null
          pricing_type?: string | null
          scope_type?: string | null
          seller_id?: string | null
          starts_at?: string | null
        }
        Update: {
          active?: boolean | null
          amount?: number | null
          applies_to_products?: string[] | null
          applies_to_scope?: string | null
          code?: string | null
          created_at?: string | null
          demo_batch?: string | null
          discount_kind?: string | null
          discount_pct?: number | null
          duration_months?: number | null
          expires_at?: string | null
          id?: string
          is_demo?: boolean | null
          pricing_type?: string | null
          scope_type?: string | null
          seller_id?: string | null
          starts_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_promo_codes_seller_id_fkey"
            columns: ["seller_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_promo_redemptions: {
        Row: {
          code: string | null
          demo_batch: string | null
          id: string
          is_demo: boolean | null
          redeemed_at: string | null
          subject_id: string | null
        }
        Insert: {
          code?: string | null
          demo_batch?: string | null
          id?: string
          is_demo?: boolean | null
          redeemed_at?: string | null
          subject_id?: string | null
        }
        Update: {
          code?: string | null
          demo_batch?: string | null
          id?: string
          is_demo?: boolean | null
          redeemed_at?: string | null
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_promo_redemptions_code_fkey"
            columns: ["code"]
            isOneToOne: false
            referencedRelation: "exp_promo_codes"
            referencedColumns: ["code"]
          },
        ]
      }
      exp_prompt_bundle: {
        Row: {
          built_at: string | null
          bundle: Json | null
          gcid: string
        }
        Insert: {
          built_at?: string | null
          bundle?: Json | null
          gcid: string
        }
        Update: {
          built_at?: string | null
          bundle?: Json | null
          gcid?: string
        }
        Relationships: []
      }
      exp_prospects: {
        Row: {
          created_at: string
          engagement_state: string
          enterprise_seller: string | null
          entity_id: string | null
          notes: Json
          prospect_id: string
          search_rank_expert: string | null
          selling_team: string | null
          territory_id: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          engagement_state?: string
          enterprise_seller?: string | null
          entity_id?: string | null
          notes?: Json
          prospect_id?: string
          search_rank_expert?: string | null
          selling_team?: string | null
          territory_id?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          engagement_state?: string
          enterprise_seller?: string | null
          entity_id?: string | null
          notes?: Json
          prospect_id?: string
          search_rank_expert?: string | null
          selling_team?: string | null
          territory_id?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_prospects_entity_id_fkey"
            columns: ["entity_id"]
            isOneToOne: false
            referencedRelation: "exp_entity"
            referencedColumns: ["entity_id"]
          },
        ]
      }
      exp_quotes: {
        Row: {
          account_id: string | null
          created_at: string | null
          created_by: string | null
          demo_batch: string | null
          id: string
          is_demo: boolean | null
          name: string | null
          opportunity_id: string | null
          state: Json | null
          status: string | null
          summary: Json | null
          updated_at: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          created_by?: string | null
          demo_batch?: string | null
          id?: string
          is_demo?: boolean | null
          name?: string | null
          opportunity_id?: string | null
          state?: Json | null
          status?: string | null
          summary?: Json | null
          updated_at?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          created_by?: string | null
          demo_batch?: string | null
          id?: string
          is_demo?: boolean | null
          name?: string | null
          opportunity_id?: string | null
          state?: Json | null
          status?: string | null
          summary?: Json | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_quotes_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_pipeline"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_r1_done: {
        Row: {
          gcid: string
        }
        Insert: {
          gcid: string
        }
        Update: {
          gcid?: string
        }
        Relationships: []
      }
      exp_r14_log: {
        Row: {
          changes: number | null
          ran_at: string | null
        }
        Insert: {
          changes?: number | null
          ran_at?: string | null
        }
        Update: {
          changes?: number | null
          ran_at?: string | null
        }
        Relationships: []
      }
      exp_r17_preview: {
        Row: {
          dupes: number | null
          entity_scope: string | null
          gcid: string | null
          names: string | null
          processed: boolean | null
          ring: string | null
          tokset: string | null
        }
        Insert: {
          dupes?: number | null
          entity_scope?: string | null
          gcid?: string | null
          names?: string | null
          processed?: boolean | null
          ring?: string | null
          tokset?: string | null
        }
        Update: {
          dupes?: number | null
          entity_scope?: string | null
          gcid?: string | null
          names?: string | null
          processed?: boolean | null
          ring?: string | null
          tokset?: string | null
        }
        Relationships: []
      }
      exp_r18_log: {
        Row: {
          ran_at: string | null
          removed: number | null
        }
        Insert: {
          ran_at?: string | null
          removed?: number | null
        }
        Update: {
          ran_at?: string | null
          removed?: number | null
        }
        Relationships: []
      }
      exp_registry_attribute_map: {
        Row: {
          attribute_id: string
          gcid: string
          node_slug: string
        }
        Insert: {
          attribute_id: string
          gcid: string
          node_slug: string
        }
        Update: {
          attribute_id?: string
          gcid?: string
          node_slug?: string
        }
        Relationships: []
      }
      exp_rel: {
        Row: {
          confidence: number
          contradicting_evidence: Json | null
          created_at: string
          evidence: Json | null
          is_primary: boolean
          last_observed_at: string | null
          last_verified_at: string | null
          object_entity_id: string | null
          object_gcid: string | null
          object_geo: Json | null
          rel_id: string
          relationship_type: string
          source: string | null
          status: string
          subject_entity_id: string
          valid_from: string
          valid_to: string | null
        }
        Insert: {
          confidence?: number
          contradicting_evidence?: Json | null
          created_at?: string
          evidence?: Json | null
          is_primary?: boolean
          last_observed_at?: string | null
          last_verified_at?: string | null
          object_entity_id?: string | null
          object_gcid?: string | null
          object_geo?: Json | null
          rel_id?: string
          relationship_type: string
          source?: string | null
          status?: string
          subject_entity_id: string
          valid_from?: string
          valid_to?: string | null
        }
        Update: {
          confidence?: number
          contradicting_evidence?: Json | null
          created_at?: string
          evidence?: Json | null
          is_primary?: boolean
          last_observed_at?: string | null
          last_verified_at?: string | null
          object_entity_id?: string | null
          object_gcid?: string | null
          object_geo?: Json | null
          rel_id?: string
          relationship_type?: string
          source?: string | null
          status?: string
          subject_entity_id?: string
          valid_from?: string
          valid_to?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_rel_object_entity_id_fkey"
            columns: ["object_entity_id"]
            isOneToOne: false
            referencedRelation: "exp_entity"
            referencedColumns: ["entity_id"]
          },
          {
            foreignKeyName: "exp_rel_object_gcid_fkey"
            columns: ["object_gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_rel_object_gcid_fkey"
            columns: ["object_gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_rel_object_gcid_fkey"
            columns: ["object_gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_rel_object_gcid_fkey"
            columns: ["object_gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_rel_object_gcid_fkey"
            columns: ["object_gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_rel_object_gcid_fkey"
            columns: ["object_gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_rel_relationship_type_fkey"
            columns: ["relationship_type"]
            isOneToOne: false
            referencedRelation: "exp_rel_types"
            referencedColumns: ["relationship_type"]
          },
          {
            foreignKeyName: "exp_rel_subject_entity_id_fkey"
            columns: ["subject_entity_id"]
            isOneToOne: false
            referencedRelation: "exp_entity"
            referencedColumns: ["entity_id"]
          },
        ]
      }
      exp_rel_types: {
        Row: {
          allows_multiple_current: boolean
          notes: string | null
          object_kind: string
          object_types: string[] | null
          relationship_type: string
          subject_types: string[]
        }
        Insert: {
          allows_multiple_current?: boolean
          notes?: string | null
          object_kind: string
          object_types?: string[] | null
          relationship_type: string
          subject_types: string[]
        }
        Update: {
          allows_multiple_current?: boolean
          notes?: string | null
          object_kind?: string
          object_types?: string[] | null
          relationship_type?: string
          subject_types?: string[]
        }
        Relationships: []
      }
      exp_renewal_config: {
        Row: {
          email: string | null
          key: string
          name: string | null
          updated_at: string | null
        }
        Insert: {
          email?: string | null
          key: string
          name?: string | null
          updated_at?: string | null
        }
        Update: {
          email?: string | null
          key?: string
          name?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      exp_revenue_components: {
        Row: {
          amount: number | null
          attributed_seller_id: string | null
          created_at: string | null
          deal_ref: string | null
          demo_batch: string | null
          group_key: string | null
          id: string
          is_demo: boolean | null
          period_start: string | null
          seller_id: string | null
          source: string | null
          territory_id: string | null
        }
        Insert: {
          amount?: number | null
          attributed_seller_id?: string | null
          created_at?: string | null
          deal_ref?: string | null
          demo_batch?: string | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          period_start?: string | null
          seller_id?: string | null
          source?: string | null
          territory_id?: string | null
        }
        Update: {
          amount?: number | null
          attributed_seller_id?: string | null
          created_at?: string | null
          deal_ref?: string | null
          demo_batch?: string | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          period_start?: string | null
          seller_id?: string | null
          source?: string | null
          territory_id?: string | null
        }
        Relationships: []
      }
      exp_ring: {
        Row: {
          color: string | null
          created_at: string | null
          display_name: string
          is_active: boolean | null
          layer: string
          ring_key: string
          schema_note: string | null
          sort: number | null
        }
        Insert: {
          color?: string | null
          created_at?: string | null
          display_name: string
          is_active?: boolean | null
          layer: string
          ring_key: string
          schema_note?: string | null
          sort?: number | null
        }
        Update: {
          color?: string | null
          created_at?: string | null
          display_name?: string
          is_active?: boolean | null
          layer?: string
          ring_key?: string
          schema_note?: string | null
          sort?: number | null
        }
        Relationships: []
      }
      exp_ring_crosswalk: {
        Row: {
          note: string | null
          source: string
          source_value: string
          target_layer: string | null
          target_ring_key: string | null
        }
        Insert: {
          note?: string | null
          source: string
          source_value: string
          target_layer?: string | null
          target_ring_key?: string | null
        }
        Update: {
          note?: string | null
          source?: string
          source_value?: string
          target_layer?: string | null
          target_ring_key?: string | null
        }
        Relationships: []
      }
      exp_ring_status: {
        Row: {
          at: string | null
          id: number
          note: string | null
          phase: string | null
          stamped_batch: number | null
        }
        Insert: {
          at?: string | null
          id?: number
          note?: string | null
          phase?: string | null
          stamped_batch?: number | null
        }
        Update: {
          at?: string | null
          id?: number
          note?: string | null
          phase?: string | null
          stamped_batch?: number | null
        }
        Relationships: []
      }
      exp_rings: {
        Row: {
          edge_properties: string[]
          legacy_key: string | null
          notes: string | null
          position: number
          ring_key: string
          ring_name: string
          schema_properties: string[]
          schema_types: string[]
          seo_function: string
        }
        Insert: {
          edge_properties: string[]
          legacy_key?: string | null
          notes?: string | null
          position: number
          ring_key: string
          ring_name: string
          schema_properties: string[]
          schema_types: string[]
          seo_function: string
        }
        Update: {
          edge_properties?: string[]
          legacy_key?: string | null
          notes?: string | null
          position?: number
          ring_key?: string
          ring_name?: string
          schema_properties?: string[]
          schema_types?: string[]
          seo_function?: string
        }
        Relationships: []
      }
      exp_roster_repair_log: {
        Row: {
          fixed: number | null
          ran_at: string | null
        }
        Insert: {
          fixed?: number | null
          ran_at?: string | null
        }
        Update: {
          fixed?: number | null
          ran_at?: string | null
        }
        Relationships: []
      }
      exp_sales_alerts: {
        Row: {
          accepted_at: string | null
          accepted_by: string | null
          accepted_task_id: string | null
          account_id: string | null
          acknowledged: boolean
          alert_type: string | null
          body: string | null
          created_at: string
          dedupe_key: string | null
          demo_batch: string | null
          dismissed_at: string | null
          id: string
          is_demo: boolean
          is_nora_suggested: boolean
          logo: string | null
          opportunity_id: string | null
          owner_id: string | null
          rule: string | null
          severity: string | null
          suggested_task: Json | null
        }
        Insert: {
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_task_id?: string | null
          account_id?: string | null
          acknowledged?: boolean
          alert_type?: string | null
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          demo_batch?: string | null
          dismissed_at?: string | null
          id?: string
          is_demo?: boolean
          is_nora_suggested?: boolean
          logo?: string | null
          opportunity_id?: string | null
          owner_id?: string | null
          rule?: string | null
          severity?: string | null
          suggested_task?: Json | null
        }
        Update: {
          accepted_at?: string | null
          accepted_by?: string | null
          accepted_task_id?: string | null
          account_id?: string | null
          acknowledged?: boolean
          alert_type?: string | null
          body?: string | null
          created_at?: string
          dedupe_key?: string | null
          demo_batch?: string | null
          dismissed_at?: string | null
          id?: string
          is_demo?: boolean
          is_nora_suggested?: boolean
          logo?: string | null
          opportunity_id?: string | null
          owner_id?: string | null
          rule?: string | null
          severity?: string | null
          suggested_task?: Json | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_sales_alerts_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_pipeline"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_sales_assignments: {
        Row: {
          assignment_type: string
          created_at: string | null
          demo_batch: string | null
          group_key: string
          id: string
          is_demo: boolean | null
          rep_id: string | null
          target_ref: string | null
        }
        Insert: {
          assignment_type: string
          created_at?: string | null
          demo_batch?: string | null
          group_key: string
          id?: string
          is_demo?: boolean | null
          rep_id?: string | null
          target_ref?: string | null
        }
        Update: {
          assignment_type?: string
          created_at?: string | null
          demo_batch?: string | null
          group_key?: string
          id?: string
          is_demo?: boolean | null
          rep_id?: string | null
          target_ref?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_sales_assignments_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_sales_category_stats: {
        Row: {
          avg_deal: number | null
          avg_margin_pct: number | null
          created_at: string | null
          group_key: string | null
          id: string
          is_demo: boolean | null
          label: string | null
          momentum_pct: number | null
          price_signal: string | null
          win_rate: number | null
        }
        Insert: {
          avg_deal?: number | null
          avg_margin_pct?: number | null
          created_at?: string | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          label?: string | null
          momentum_pct?: number | null
          price_signal?: string | null
          win_rate?: number | null
        }
        Update: {
          avg_deal?: number | null
          avg_margin_pct?: number | null
          created_at?: string | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          label?: string | null
          momentum_pct?: number | null
          price_signal?: string | null
          win_rate?: number | null
        }
        Relationships: []
      }
      exp_sales_demos: {
        Row: {
          agenda: string | null
          attended: boolean | null
          attendees: Json | null
          booked_at: string | null
          calendar_error: string | null
          calendar_event_id: string | null
          calendar_status: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string | null
          deal_value: number | null
          demo_batch: string | null
          disposition: string | null
          duration_minutes: number | null
          follow_up: string | null
          id: string
          is_demo: boolean | null
          meeting_kind: string | null
          objective: string | null
          opportunity_id: string | null
          outcome: string | null
          prospect_id: string | null
          prospect_label: string | null
          recording_url: string | null
          seller_id: string | null
        }
        Insert: {
          agenda?: string | null
          attended?: boolean | null
          attendees?: Json | null
          booked_at?: string | null
          calendar_error?: string | null
          calendar_event_id?: string | null
          calendar_status?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          deal_value?: number | null
          demo_batch?: string | null
          disposition?: string | null
          duration_minutes?: number | null
          follow_up?: string | null
          id?: string
          is_demo?: boolean | null
          meeting_kind?: string | null
          objective?: string | null
          opportunity_id?: string | null
          outcome?: string | null
          prospect_id?: string | null
          prospect_label?: string | null
          recording_url?: string | null
          seller_id?: string | null
        }
        Update: {
          agenda?: string | null
          attended?: boolean | null
          attendees?: Json | null
          booked_at?: string | null
          calendar_error?: string | null
          calendar_event_id?: string | null
          calendar_status?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string | null
          deal_value?: number | null
          demo_batch?: string | null
          disposition?: string | null
          duration_minutes?: number | null
          follow_up?: string | null
          id?: string
          is_demo?: boolean | null
          meeting_kind?: string | null
          objective?: string | null
          opportunity_id?: string | null
          outcome?: string | null
          prospect_id?: string | null
          prospect_label?: string | null
          recording_url?: string | null
          seller_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_sales_demos_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_pipeline"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_sales_notes: {
        Row: {
          body: string | null
          callback_at: string | null
          callback_priority: boolean | null
          created_at: string | null
          created_by: string | null
          demo_batch: string | null
          id: string
          is_demo: boolean | null
          mentions: string[] | null
          pinned: boolean | null
          seller_id: string | null
          subject_id: string | null
          subject_label: string | null
          subject_type: string | null
        }
        Insert: {
          body?: string | null
          callback_at?: string | null
          callback_priority?: boolean | null
          created_at?: string | null
          created_by?: string | null
          demo_batch?: string | null
          id?: string
          is_demo?: boolean | null
          mentions?: string[] | null
          pinned?: boolean | null
          seller_id?: string | null
          subject_id?: string | null
          subject_label?: string | null
          subject_type?: string | null
        }
        Update: {
          body?: string | null
          callback_at?: string | null
          callback_priority?: boolean | null
          created_at?: string | null
          created_by?: string | null
          demo_batch?: string | null
          id?: string
          is_demo?: boolean | null
          mentions?: string[] | null
          pinned?: boolean | null
          seller_id?: string | null
          subject_id?: string | null
          subject_label?: string | null
          subject_type?: string | null
        }
        Relationships: []
      }
      exp_sales_pipeline: {
        Row: {
          account_id: string | null
          created_at: string | null
          created_by: string | null
          demo_batch: string | null
          expected_close: string | null
          id: string
          is_demo: boolean | null
          lost_reason: string | null
          name: string
          notes: string | null
          org_id: string | null
          owner: string | null
          probability: number | null
          product_summary: string | null
          source_channel: string | null
          source_owner: string | null
          stage: string
          updated_at: string | null
          value: number | null
          win_back: boolean | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          created_by?: string | null
          demo_batch?: string | null
          expected_close?: string | null
          id?: string
          is_demo?: boolean | null
          lost_reason?: string | null
          name: string
          notes?: string | null
          org_id?: string | null
          owner?: string | null
          probability?: number | null
          product_summary?: string | null
          source_channel?: string | null
          source_owner?: string | null
          stage?: string
          updated_at?: string | null
          value?: number | null
          win_back?: boolean | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          created_by?: string | null
          demo_batch?: string | null
          expected_close?: string | null
          id?: string
          is_demo?: boolean | null
          lost_reason?: string | null
          name?: string
          notes?: string | null
          org_id?: string | null
          owner?: string | null
          probability?: number | null
          product_summary?: string | null
          source_channel?: string | null
          source_owner?: string | null
          stage?: string
          updated_at?: string | null
          value?: number | null
          win_back?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_sales_pipeline_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exp_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_sales_quotas: {
        Row: {
          actual: number | null
          created_at: string | null
          demo_batch: string | null
          group_key: string | null
          id: string
          is_demo: boolean | null
          period_start: string | null
          period_type: string | null
          rep_id: string | null
          target: number | null
        }
        Insert: {
          actual?: number | null
          created_at?: string | null
          demo_batch?: string | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          period_start?: string | null
          period_type?: string | null
          rep_id?: string | null
          target?: number | null
        }
        Update: {
          actual?: number | null
          created_at?: string | null
          demo_batch?: string | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          period_start?: string | null
          period_type?: string | null
          rep_id?: string | null
          target?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_sales_quotas_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_sales_rep_metrics: {
        Row: {
          attempted_claims: number | null
          claims: number | null
          closings: number | null
          created_at: string | null
          demo_batch: string | null
          demos_attended: number | null
          demos_booked: number | null
          engaged_30d: number | null
          group_key: string | null
          id: string
          is_demo: boolean | null
          logo_signals: number | null
          logos_assigned: number | null
          period_start: string
          profiles_assigned: number | null
          rep_id: string | null
          revenue: number | null
          upgrades: number | null
          views: number | null
        }
        Insert: {
          attempted_claims?: number | null
          claims?: number | null
          closings?: number | null
          created_at?: string | null
          demo_batch?: string | null
          demos_attended?: number | null
          demos_booked?: number | null
          engaged_30d?: number | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          logo_signals?: number | null
          logos_assigned?: number | null
          period_start: string
          profiles_assigned?: number | null
          rep_id?: string | null
          revenue?: number | null
          upgrades?: number | null
          views?: number | null
        }
        Update: {
          attempted_claims?: number | null
          claims?: number | null
          closings?: number | null
          created_at?: string | null
          demo_batch?: string | null
          demos_attended?: number | null
          demos_booked?: number | null
          engaged_30d?: number | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          logo_signals?: number | null
          logos_assigned?: number | null
          period_start?: string
          profiles_assigned?: number | null
          rep_id?: string | null
          revenue?: number | null
          upgrades?: number | null
          views?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_sales_rep_metrics_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_sales_rep_verticals: {
        Row: {
          created_at: string | null
          demo_batch: string | null
          group_key: string | null
          id: string
          is_demo: boolean | null
          rep_id: string | null
        }
        Insert: {
          created_at?: string | null
          demo_batch?: string | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          rep_id?: string | null
        }
        Update: {
          created_at?: string | null
          demo_batch?: string | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          rep_id?: string | null
        }
        Relationships: []
      }
      exp_sales_reps: {
        Row: {
          attribution_target: number | null
          backup_rep_id: string | null
          created_at: string | null
          demo_batch: string | null
          email: string | null
          group_key: string
          hire_date: string | null
          id: string
          is_demo: boolean | null
          name: string
          on_duty: boolean | null
          phone: string | null
          photo_url: string | null
          role: string
          sdrcloud_url: string | null
          slack_channel: string | null
          team_name: string | null
          title: string | null
        }
        Insert: {
          attribution_target?: number | null
          backup_rep_id?: string | null
          created_at?: string | null
          demo_batch?: string | null
          email?: string | null
          group_key: string
          hire_date?: string | null
          id?: string
          is_demo?: boolean | null
          name: string
          on_duty?: boolean | null
          phone?: string | null
          photo_url?: string | null
          role: string
          sdrcloud_url?: string | null
          slack_channel?: string | null
          team_name?: string | null
          title?: string | null
        }
        Update: {
          attribution_target?: number | null
          backup_rep_id?: string | null
          created_at?: string | null
          demo_batch?: string | null
          email?: string | null
          group_key?: string
          hire_date?: string | null
          id?: string
          is_demo?: boolean | null
          name?: string
          on_duty?: boolean | null
          phone?: string | null
          photo_url?: string | null
          role?: string
          sdrcloud_url?: string | null
          slack_channel?: string | null
          team_name?: string | null
          title?: string | null
        }
        Relationships: []
      }
      exp_sales_tasks: {
        Row: {
          account_id: string | null
          created_at: string | null
          created_by: string | null
          demo_batch: string | null
          done: boolean | null
          due_at: string | null
          id: string
          is_demo: boolean | null
          opportunity_id: string | null
          owner_id: string | null
          priority: string | null
          reminded_at: string | null
          source_alert_id: string | null
          task_type: string | null
          title: string | null
        }
        Insert: {
          account_id?: string | null
          created_at?: string | null
          created_by?: string | null
          demo_batch?: string | null
          done?: boolean | null
          due_at?: string | null
          id?: string
          is_demo?: boolean | null
          opportunity_id?: string | null
          owner_id?: string | null
          priority?: string | null
          reminded_at?: string | null
          source_alert_id?: string | null
          task_type?: string | null
          title?: string | null
        }
        Update: {
          account_id?: string | null
          created_at?: string | null
          created_by?: string | null
          demo_batch?: string | null
          done?: boolean | null
          due_at?: string | null
          id?: string
          is_demo?: boolean | null
          opportunity_id?: string | null
          owner_id?: string | null
          priority?: string | null
          reminded_at?: string | null
          source_alert_id?: string | null
          task_type?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_sales_tasks_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "exp_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_sales_tasks_opportunity_id_fkey"
            columns: ["opportunity_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_pipeline"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_sales_tasks_owner_id_fkey"
            columns: ["owner_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_schema_prop_waivers: {
        Row: {
          created_at: string | null
          gcid: string
          property_id: string
          reason: string
          ruled_by: string
          type_id: string
        }
        Insert: {
          created_at?: string | null
          gcid?: string
          property_id: string
          reason: string
          ruled_by?: string
          type_id: string
        }
        Update: {
          created_at?: string | null
          gcid?: string
          property_id?: string
          reason?: string
          ruled_by?: string
          type_id?: string
        }
        Relationships: []
      }
      exp_schema_type_ring_map: {
        Row: {
          inherited_from: string
          ring_key: string
          schema_property: string
          schema_type: string
          value_range: string | null
        }
        Insert: {
          inherited_from: string
          ring_key: string
          schema_property: string
          schema_type: string
          value_range?: string | null
        }
        Update: {
          inherited_from?: string
          ring_key?: string
          schema_property?: string
          schema_type?: string
          value_range?: string | null
        }
        Relationships: []
      }
      exp_schemaorg_properties: {
        Row: {
          comment: string | null
          domain_types: string[] | null
          label: string | null
          property_id: string
          range_types: string[] | null
        }
        Insert: {
          comment?: string | null
          domain_types?: string[] | null
          label?: string | null
          property_id: string
          range_types?: string[] | null
        }
        Update: {
          comment?: string | null
          domain_types?: string[] | null
          label?: string | null
          property_id?: string
          range_types?: string[] | null
        }
        Relationships: []
      }
      exp_schemaorg_types: {
        Row: {
          comment: string | null
          label: string | null
          own_properties: Json | null
          parents: string[] | null
          type_id: string
        }
        Insert: {
          comment?: string | null
          label?: string | null
          own_properties?: Json | null
          parents?: string[] | null
          type_id: string
        }
        Update: {
          comment?: string | null
          label?: string | null
          own_properties?: Json | null
          parents?: string[] | null
          type_id?: string
        }
        Relationships: []
      }
      exp_score_class_profiles: {
        Row: {
          archetype: string
          is_draft: boolean | null
          note: string | null
          updated_at: string | null
          version: string | null
          weights: Json
        }
        Insert: {
          archetype: string
          is_draft?: boolean | null
          note?: string | null
          updated_at?: string | null
          version?: string | null
          weights: Json
        }
        Update: {
          archetype?: string
          is_draft?: boolean | null
          note?: string | null
          updated_at?: string | null
          version?: string | null
          weights?: Json
        }
        Relationships: []
      }
      exp_search_dirty: {
        Row: {
          entity_id: string
          queued_at: string
          source: string | null
        }
        Insert: {
          entity_id: string
          queued_at?: string
          source?: string | null
        }
        Update: {
          entity_id?: string
          queued_at?: string
          source?: string | null
        }
        Relationships: []
      }
      exp_sec_requests: {
        Row: {
          batch: number | null
          created_at: string | null
          request_id: number
        }
        Insert: {
          batch?: number | null
          created_at?: string | null
          request_id: number
        }
        Update: {
          batch?: number | null
          created_at?: string | null
          request_id?: number
        }
        Relationships: []
      }
      exp_sec_state: {
        Row: {
          attempts: number | null
          batch: number | null
          gcid: string
          status: string | null
          updated_at: string | null
        }
        Insert: {
          attempts?: number | null
          batch?: number | null
          gcid: string
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          attempts?: number | null
          batch?: number | null
          gcid?: string
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      exp_sentinel_state: {
        Row: {
          id: number
          sweep_started: string | null
        }
        Insert: {
          id?: number
          sweep_started?: string | null
        }
        Update: {
          id?: number
          sweep_started?: string | null
        }
        Relationships: []
      }
      exp_sitemap_partition: {
        Row: {
          changefreq: string | null
          id: string
          is_demo: boolean | null
          last_built_at: string | null
          max_score: number | null
          min_score: number | null
          partition_key: string | null
          priority: number | null
          url_count: number | null
        }
        Insert: {
          changefreq?: string | null
          id?: string
          is_demo?: boolean | null
          last_built_at?: string | null
          max_score?: number | null
          min_score?: number | null
          partition_key?: string | null
          priority?: number | null
          url_count?: number | null
        }
        Update: {
          changefreq?: string | null
          id?: string
          is_demo?: boolean | null
          last_built_at?: string | null
          max_score?: number | null
          min_score?: number | null
          partition_key?: string | null
          priority?: number | null
          url_count?: number | null
        }
        Relationships: []
      }
      exp_skill_eval: {
        Row: {
          created_at: string
          expected: Json
          fixture: Json
          id: string
          last_result: Json | null
          last_run_at: string | null
          name: string
          skill_key: string
          status: string
        }
        Insert: {
          created_at?: string
          expected?: Json
          fixture?: Json
          id?: string
          last_result?: Json | null
          last_run_at?: string | null
          name: string
          skill_key: string
          status?: string
        }
        Update: {
          created_at?: string
          expected?: Json
          fixture?: Json
          id?: string
          last_result?: Json | null
          last_run_at?: string | null
          name?: string
          skill_key?: string
          status?: string
        }
        Relationships: []
      }
      exp_skill_registry: {
        Row: {
          affects_lanes: string[]
          autonomy: string
          captures_consent: boolean
          charges_money: boolean
          created_at: string
          decline_mute_days: number
          entity_types: string[]
          estimated_duration: string | null
          expected_srs_lift: number | null
          explanation_template: string | null
          gap_closed: string | null
          graph_writes: string[]
          guardrails: string[]
          id: string
          is_active: boolean
          is_async: boolean
          key: string
          model_tier: string
          offer_expected_points: number | null
          offer_ranking_effect: string | null
          owning_surface: string | null
          permanently_dismissible: boolean
          price_ref: string | null
          produces_report: boolean
          reads_state: string[]
          report_to_weekly_digest: boolean
          requires_entitlement: string | null
          requires_user_approval: boolean
          result_metrics: string[]
          status: string
          success_event: string | null
          summary: string | null
          title: string
          tools_used: string[]
          tracks_results: boolean
          trial_eligible: boolean
          triggers: string[]
          updated_at: string
          value_loop: string | null
          value_prop: string | null
          version: string
        }
        Insert: {
          affects_lanes?: string[]
          autonomy?: string
          captures_consent?: boolean
          charges_money?: boolean
          created_at?: string
          decline_mute_days?: number
          entity_types?: string[]
          estimated_duration?: string | null
          expected_srs_lift?: number | null
          explanation_template?: string | null
          gap_closed?: string | null
          graph_writes?: string[]
          guardrails?: string[]
          id?: string
          is_active?: boolean
          is_async?: boolean
          key: string
          model_tier?: string
          offer_expected_points?: number | null
          offer_ranking_effect?: string | null
          owning_surface?: string | null
          permanently_dismissible?: boolean
          price_ref?: string | null
          produces_report?: boolean
          reads_state?: string[]
          report_to_weekly_digest?: boolean
          requires_entitlement?: string | null
          requires_user_approval?: boolean
          result_metrics?: string[]
          status?: string
          success_event?: string | null
          summary?: string | null
          title: string
          tools_used?: string[]
          tracks_results?: boolean
          trial_eligible?: boolean
          triggers?: string[]
          updated_at?: string
          value_loop?: string | null
          value_prop?: string | null
          version?: string
        }
        Update: {
          affects_lanes?: string[]
          autonomy?: string
          captures_consent?: boolean
          charges_money?: boolean
          created_at?: string
          decline_mute_days?: number
          entity_types?: string[]
          estimated_duration?: string | null
          expected_srs_lift?: number | null
          explanation_template?: string | null
          gap_closed?: string | null
          graph_writes?: string[]
          guardrails?: string[]
          id?: string
          is_active?: boolean
          is_async?: boolean
          key?: string
          model_tier?: string
          offer_expected_points?: number | null
          offer_ranking_effect?: string | null
          owning_surface?: string | null
          permanently_dismissible?: boolean
          price_ref?: string | null
          produces_report?: boolean
          reads_state?: string[]
          report_to_weekly_digest?: boolean
          requires_entitlement?: string | null
          requires_user_approval?: boolean
          result_metrics?: string[]
          status?: string
          success_event?: string | null
          summary?: string | null
          title?: string
          tools_used?: string[]
          tracks_results?: boolean
          trial_eligible?: boolean
          triggers?: string[]
          updated_at?: string
          value_loop?: string | null
          value_prop?: string | null
          version?: string
        }
        Relationships: []
      }
      exp_skill_run: {
        Row: {
          actor: string | null
          actual_srs_delta: number | null
          capability_keys: string[]
          created_at: string
          entity_ref: string | null
          entity_type: string | null
          error: string | null
          expected_srs_lift: number | null
          finished_at: string | null
          graph_writes: Json
          id: string
          inputs: Json
          mode: string
          outputs: Json
          skill_key: string
          skill_version: string | null
          started_at: string | null
          status: string
          telemetry: Json
          trace: Json
          trigger: string | null
          verdict: string | null
        }
        Insert: {
          actor?: string | null
          actual_srs_delta?: number | null
          capability_keys?: string[]
          created_at?: string
          entity_ref?: string | null
          entity_type?: string | null
          error?: string | null
          expected_srs_lift?: number | null
          finished_at?: string | null
          graph_writes?: Json
          id?: string
          inputs?: Json
          mode?: string
          outputs?: Json
          skill_key: string
          skill_version?: string | null
          started_at?: string | null
          status?: string
          telemetry?: Json
          trace?: Json
          trigger?: string | null
          verdict?: string | null
        }
        Update: {
          actor?: string | null
          actual_srs_delta?: number | null
          capability_keys?: string[]
          created_at?: string
          entity_ref?: string | null
          entity_type?: string | null
          error?: string | null
          expected_srs_lift?: number | null
          finished_at?: string | null
          graph_writes?: Json
          id?: string
          inputs?: Json
          mode?: string
          outputs?: Json
          skill_key?: string
          skill_version?: string | null
          started_at?: string | null
          status?: string
          telemetry?: Json
          trace?: Json
          trigger?: string | null
          verdict?: string | null
        }
        Relationships: []
      }
      exp_skill_version: {
        Row: {
          id: string
          manifest: Json
          note: string | null
          published_at: string
          published_by: string | null
          skill_key: string
          status: string
          version: string
        }
        Insert: {
          id?: string
          manifest: Json
          note?: string | null
          published_at?: string
          published_by?: string | null
          skill_key: string
          status: string
          version: string
        }
        Update: {
          id?: string
          manifest?: Json
          note?: string | null
          published_at?: string
          published_by?: string | null
          skill_key?: string
          status?: string
          version?: string
        }
        Relationships: []
      }
      exp_sponsored_pricing: {
        Row: {
          basis: string | null
          created_at: string | null
          effective_on: string | null
          floor_price: number | null
          gcid: string | null
          geo_type: string | null
          id: string
          is_demo: boolean | null
          monthly_price: number | null
          notes: string | null
          price_per_1k_views: number | null
          pricing_mode: string | null
          spots: number | null
          tier: string | null
          version: number | null
        }
        Insert: {
          basis?: string | null
          created_at?: string | null
          effective_on?: string | null
          floor_price?: number | null
          gcid?: string | null
          geo_type?: string | null
          id?: string
          is_demo?: boolean | null
          monthly_price?: number | null
          notes?: string | null
          price_per_1k_views?: number | null
          pricing_mode?: string | null
          spots?: number | null
          tier?: string | null
          version?: number | null
        }
        Update: {
          basis?: string | null
          created_at?: string | null
          effective_on?: string | null
          floor_price?: number | null
          gcid?: string | null
          geo_type?: string | null
          id?: string
          is_demo?: boolean | null
          monthly_price?: number | null
          notes?: string | null
          price_per_1k_views?: number | null
          pricing_mode?: string | null
          spots?: number | null
          tier?: string | null
          version?: number | null
        }
        Relationships: []
      }
      exp_sponsored_slots: {
        Row: {
          advertiser_name: string | null
          advertiser_org_id: string | null
          created_at: string | null
          ends_on: string | null
          gcid: string | null
          geo_type: string | null
          geo_value: string | null
          id: string
          is_demo: boolean | null
          locked_at: string | null
          locked_per_1k: number | null
          locked_price: number | null
          position: number | null
          price: number | null
          pricing_mode: string | null
          starts_on: string | null
          status: string | null
        }
        Insert: {
          advertiser_name?: string | null
          advertiser_org_id?: string | null
          created_at?: string | null
          ends_on?: string | null
          gcid?: string | null
          geo_type?: string | null
          geo_value?: string | null
          id?: string
          is_demo?: boolean | null
          locked_at?: string | null
          locked_per_1k?: number | null
          locked_price?: number | null
          position?: number | null
          price?: number | null
          pricing_mode?: string | null
          starts_on?: string | null
          status?: string | null
        }
        Update: {
          advertiser_name?: string | null
          advertiser_org_id?: string | null
          created_at?: string | null
          ends_on?: string | null
          gcid?: string | null
          geo_type?: string | null
          geo_value?: string | null
          id?: string
          is_demo?: boolean | null
          locked_at?: string | null
          locked_per_1k?: number | null
          locked_price?: number | null
          position?: number | null
          price?: number | null
          pricing_mode?: string | null
          starts_on?: string | null
          status?: string | null
        }
        Relationships: []
      }
      exp_stage_requirements: {
        Row: {
          field_label: string | null
          field_type: string | null
          id: string
          required: boolean | null
          sort: number | null
          stage_key: string | null
        }
        Insert: {
          field_label?: string | null
          field_type?: string | null
          id?: string
          required?: boolean | null
          sort?: number | null
          stage_key?: string | null
        }
        Update: {
          field_label?: string | null
          field_type?: string | null
          id?: string
          required?: boolean | null
          sort?: number | null
          stage_key?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_stage_requirements_stage_key_fkey"
            columns: ["stage_key"]
            isOneToOne: false
            referencedRelation: "exp_pipeline_stages"
            referencedColumns: ["key"]
          },
        ]
      }
      exp_taxonomy: {
        Row: {
          created_at: string | null
          description: string | null
          entity_scope: string
          gcid: string | null
          id: string
          is_active: boolean | null
          is_required: boolean | null
          level: string | null
          parent_id: string | null
          priority: number | null
          schema_property: string | null
          schema_type: string | null
          score_weight: number | null
          search_intent: string | null
          search_volume_monthly: number | null
          source: string | null
          term: string | null
          term_display: string | null
          term_slug: string | null
          updated_at: string | null
          use_agents: boolean | null
          use_schema: boolean | null
          use_search: boolean | null
          use_srp: boolean | null
          use_voce: boolean | null
          validated: boolean | null
          wikidata_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          entity_scope?: string
          gcid?: string | null
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          level?: string | null
          parent_id?: string | null
          priority?: number | null
          schema_property?: string | null
          schema_type?: string | null
          score_weight?: number | null
          search_intent?: string | null
          search_volume_monthly?: number | null
          source?: string | null
          term?: string | null
          term_display?: string | null
          term_slug?: string | null
          updated_at?: string | null
          use_agents?: boolean | null
          use_schema?: boolean | null
          use_search?: boolean | null
          use_srp?: boolean | null
          use_voce?: boolean | null
          validated?: boolean | null
          wikidata_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          entity_scope?: string
          gcid?: string | null
          id?: string
          is_active?: boolean | null
          is_required?: boolean | null
          level?: string | null
          parent_id?: string | null
          priority?: number | null
          schema_property?: string | null
          schema_type?: string | null
          score_weight?: number | null
          search_intent?: string | null
          search_volume_monthly?: number | null
          source?: string | null
          term?: string | null
          term_display?: string | null
          term_slug?: string | null
          updated_at?: string | null
          use_agents?: boolean | null
          use_schema?: boolean | null
          use_search?: boolean | null
          use_srp?: boolean | null
          use_voce?: boolean | null
          validated?: boolean | null
          wikidata_id?: string | null
        }
        Relationships: []
      }
      exp_territories: {
        Row: {
          agent_count: number | null
          brand_count: number | null
          created_at: string | null
          gcid: string | null
          geo_scope: string | null
          group_key: string | null
          id: string
          is_catchall: boolean | null
          label: string | null
          office_count: number | null
          region: string | null
          seller_id: string | null
          seq: number | null
          status: string | null
          tier: string | null
        }
        Insert: {
          agent_count?: number | null
          brand_count?: number | null
          created_at?: string | null
          gcid?: string | null
          geo_scope?: string | null
          group_key?: string | null
          id?: string
          is_catchall?: boolean | null
          label?: string | null
          office_count?: number | null
          region?: string | null
          seller_id?: string | null
          seq?: number | null
          status?: string | null
          tier?: string | null
        }
        Update: {
          agent_count?: number | null
          brand_count?: number | null
          created_at?: string | null
          gcid?: string | null
          geo_scope?: string | null
          group_key?: string | null
          id?: string
          is_catchall?: boolean | null
          label?: string | null
          office_count?: number | null
          region?: string | null
          seller_id?: string | null
          seq?: number | null
          status?: string | null
          tier?: string | null
        }
        Relationships: []
      }
      exp_territory_brand: {
        Row: {
          created_at: string | null
          id: string
          lane: string | null
          org_id: string | null
          success_handoff_at: string | null
          success_handoff_opportunity_id: string | null
          territory_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string
          lane?: string | null
          org_id?: string | null
          success_handoff_at?: string | null
          success_handoff_opportunity_id?: string | null
          territory_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string
          lane?: string | null
          org_id?: string | null
          success_handoff_at?: string | null
          success_handoff_opportunity_id?: string | null
          territory_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_territory_brand_success_handoff_opportunity_id_fkey"
            columns: ["success_handoff_opportunity_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_pipeline"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_territory_proposals: {
        Row: {
          created_at: string | null
          created_by: string | null
          demo_batch: string | null
          gcid: string | null
          group_key: string | null
          id: string
          is_demo: boolean | null
          lane: string | null
          payload: Json | null
          proposed_geo: string | null
          proposed_label: string | null
          proposed_tier: string | null
          rationale: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          state: string | null
        }
        Insert: {
          created_at?: string | null
          created_by?: string | null
          demo_batch?: string | null
          gcid?: string | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          lane?: string | null
          payload?: Json | null
          proposed_geo?: string | null
          proposed_label?: string | null
          proposed_tier?: string | null
          rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string | null
        }
        Update: {
          created_at?: string | null
          created_by?: string | null
          demo_batch?: string | null
          gcid?: string | null
          group_key?: string | null
          id?: string
          is_demo?: boolean | null
          lane?: string | null
          payload?: Json | null
          proposed_geo?: string | null
          proposed_label?: string | null
          proposed_tier?: string | null
          rationale?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          state?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_territory_proposals_reviewed_by_fkey"
            columns: ["reviewed_by"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_territory_ramps: {
        Row: {
          created_at: string | null
          demo_batch: string | null
          id: string
          is_demo: boolean | null
          month_offset: number | null
          ramp_pct: number | null
          rep_id: string | null
          territory_id: string | null
        }
        Insert: {
          created_at?: string | null
          demo_batch?: string | null
          id?: string
          is_demo?: boolean | null
          month_offset?: number | null
          ramp_pct?: number | null
          rep_id?: string | null
          territory_id?: string | null
        }
        Update: {
          created_at?: string | null
          demo_batch?: string | null
          id?: string
          is_demo?: boolean | null
          month_offset?: number | null
          ramp_pct?: number | null
          rep_id?: string | null
          territory_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_territory_ramps_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_territory_ramps_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "exp_territories"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_territory_rules: {
        Row: {
          agents_per_territory: number | null
          logos_per_territory: number | null
          max_users: number | null
          min_users: number | null
          notes: string | null
          owns_individuals: boolean | null
          tier: string
        }
        Insert: {
          agents_per_territory?: number | null
          logos_per_territory?: number | null
          max_users?: number | null
          min_users?: number | null
          notes?: string | null
          owns_individuals?: boolean | null
          tier: string
        }
        Update: {
          agents_per_territory?: number | null
          logos_per_territory?: number | null
          max_users?: number | null
          min_users?: number | null
          notes?: string | null
          owns_individuals?: boolean | null
          tier?: string
        }
        Relationships: []
      }
      exp_territory_seats: {
        Row: {
          created_at: string
          group_key: string | null
          id: string
          is_nora_default: boolean
          lane_role: string
          monthly_quota: number | null
          rep_id: string
          territory_id: string
        }
        Insert: {
          created_at?: string
          group_key?: string | null
          id?: string
          is_nora_default?: boolean
          lane_role: string
          monthly_quota?: number | null
          rep_id: string
          territory_id: string
        }
        Update: {
          created_at?: string
          group_key?: string | null
          id?: string
          is_nora_default?: boolean
          lane_role?: string
          monthly_quota?: number | null
          rep_id?: string
          territory_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_territory_seats_rep_id_fkey"
            columns: ["rep_id"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_territory_seats_territory_id_fkey"
            columns: ["territory_id"]
            isOneToOne: false
            referencedRelation: "exp_territories"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_trial_extensions: {
        Row: {
          created_at: string | null
          days: number | null
          demo_batch: string | null
          entitlement_id: string | null
          granted_by: string | null
          id: string
          is_demo: boolean | null
          reason: string | null
          subject_id: string | null
        }
        Insert: {
          created_at?: string | null
          days?: number | null
          demo_batch?: string | null
          entitlement_id?: string | null
          granted_by?: string | null
          id?: string
          is_demo?: boolean | null
          reason?: string | null
          subject_id?: string | null
        }
        Update: {
          created_at?: string | null
          days?: number | null
          demo_batch?: string | null
          entitlement_id?: string | null
          granted_by?: string | null
          id?: string
          is_demo?: boolean | null
          reason?: string | null
          subject_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_trial_extensions_granted_by_fkey"
            columns: ["granted_by"]
            isOneToOne: false
            referencedRelation: "exp_sales_reps"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_us_cities: {
        Row: {
          city: string
          id: number
          lat: number
          lng: number
          population: number
          state_abbr: string
        }
        Insert: {
          city: string
          id?: number
          lat: number
          lng: number
          population?: number
          state_abbr: string
        }
        Update: {
          city?: string
          id?: number
          lat?: number
          lng?: number
          population?: number
          state_abbr?: string
        }
        Relationships: []
      }
      exp_usage_meter: {
        Row: {
          contract_id: string
          created_at: string | null
          demo_batch: string | null
          high_water_qty: number | null
          id: string
          included_qty: number | null
          is_demo: boolean | null
          line_id: string | null
          measured_qty: number | null
          metric: string | null
          period_end: string | null
          period_start: string | null
          product_code: string | null
          source: string | null
        }
        Insert: {
          contract_id: string
          created_at?: string | null
          demo_batch?: string | null
          high_water_qty?: number | null
          id?: string
          included_qty?: number | null
          is_demo?: boolean | null
          line_id?: string | null
          measured_qty?: number | null
          metric?: string | null
          period_end?: string | null
          period_start?: string | null
          product_code?: string | null
          source?: string | null
        }
        Update: {
          contract_id?: string
          created_at?: string | null
          demo_batch?: string | null
          high_water_qty?: number | null
          id?: string
          included_qty?: number | null
          is_demo?: boolean | null
          line_id?: string | null
          measured_qty?: number | null
          metric?: string | null
          period_end?: string | null
          period_start?: string | null
          product_code?: string | null
          source?: string | null
        }
        Relationships: []
      }
      exp_v3_done: {
        Row: {
          gcid: string
        }
        Insert: {
          gcid: string
        }
        Update: {
          gcid?: string
        }
        Relationships: []
      }
      exp_verification_requests: {
        Row: {
          attempts: number
          channel: string
          claim_event_id: string
          claim_id: string | null
          code_hash: string | null
          created_at: string
          destination: string | null
          entity_id: string | null
          entity_type: string | null
          expires_at: string | null
          id: string
          requested_by: string | null
          status: string
          verified_at: string | null
        }
        Insert: {
          attempts?: number
          channel?: string
          claim_event_id: string
          claim_id?: string | null
          code_hash?: string | null
          created_at?: string
          destination?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          requested_by?: string | null
          status?: string
          verified_at?: string | null
        }
        Update: {
          attempts?: number
          channel?: string
          claim_event_id?: string
          claim_id?: string | null
          code_hash?: string | null
          created_at?: string
          destination?: string | null
          entity_id?: string | null
          entity_type?: string | null
          expires_at?: string | null
          id?: string
          requested_by?: string | null
          status?: string
          verified_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_verification_requests_claim_event_id_fkey"
            columns: ["claim_event_id"]
            isOneToOne: false
            referencedRelation: "exp_claim_events"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_verification_requests_claim_id_fkey"
            columns: ["claim_id"]
            isOneToOne: false
            referencedRelation: "exp_claim"
            referencedColumns: ["claim_id"]
          },
        ]
      }
      exp_vertical_node_registry: {
        Row: {
          compliance_notes: string | null
          connection_method: string
          counts_toward_m: boolean
          created_at: string | null
          entity_scope: string | null
          gcid: string
          id: string
          is_active: boolean | null
          node_class: string | null
          node_description: string | null
          node_name: string
          node_slug: string
          notes: string | null
          owns_lane: string | null
          priority: number | null
          required_for_score: boolean | null
          requires_verification: boolean
          ring: string
          schema_property: string | null
          schema_type: string | null
          score_points: number | null
          updated_at: string | null
          url_example: string | null
          url_pattern: string | null
        }
        Insert: {
          compliance_notes?: string | null
          connection_method: string
          counts_toward_m?: boolean
          created_at?: string | null
          entity_scope?: string | null
          gcid: string
          id?: string
          is_active?: boolean | null
          node_class?: string | null
          node_description?: string | null
          node_name: string
          node_slug: string
          notes?: string | null
          owns_lane?: string | null
          priority?: number | null
          required_for_score?: boolean | null
          requires_verification?: boolean
          ring: string
          schema_property?: string | null
          schema_type?: string | null
          score_points?: number | null
          updated_at?: string | null
          url_example?: string | null
          url_pattern?: string | null
        }
        Update: {
          compliance_notes?: string | null
          connection_method?: string
          counts_toward_m?: boolean
          created_at?: string | null
          entity_scope?: string | null
          gcid?: string
          id?: string
          is_active?: boolean | null
          node_class?: string | null
          node_description?: string | null
          node_name?: string
          node_slug?: string
          notes?: string | null
          owns_lane?: string | null
          priority?: number | null
          required_for_score?: boolean | null
          requires_verification?: boolean
          ring?: string
          schema_property?: string | null
          schema_type?: string | null
          score_points?: number | null
          updated_at?: string | null
          url_example?: string | null
          url_pattern?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_vertical_node_registry_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_vertical_node_registry_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_vertical_node_registry_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_vertical_node_registry_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_vertical_node_registry_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_vertical_node_registry_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      exp_voce_article: {
        Row: {
          author_entity_id: string | null
          author_entity_type: string | null
          author_name: string | null
          body_excerpt: string | null
          boost_ends_on: string | null
          boost_placements: Json | null
          boost_spend: number | null
          boost_starts_on: string | null
          boosted: boolean | null
          created_at: string | null
          gcid: string | null
          id: string
          is_demo: boolean | null
          knows_about: Json | null
          published_on: string | null
          slug: string | null
          title: string | null
          topic: string | null
        }
        Insert: {
          author_entity_id?: string | null
          author_entity_type?: string | null
          author_name?: string | null
          body_excerpt?: string | null
          boost_ends_on?: string | null
          boost_placements?: Json | null
          boost_spend?: number | null
          boost_starts_on?: string | null
          boosted?: boolean | null
          created_at?: string | null
          gcid?: string | null
          id?: string
          is_demo?: boolean | null
          knows_about?: Json | null
          published_on?: string | null
          slug?: string | null
          title?: string | null
          topic?: string | null
        }
        Update: {
          author_entity_id?: string | null
          author_entity_type?: string | null
          author_name?: string | null
          body_excerpt?: string | null
          boost_ends_on?: string | null
          boost_placements?: Json | null
          boost_spend?: number | null
          boost_starts_on?: string | null
          boosted?: boolean | null
          created_at?: string | null
          gcid?: string | null
          id?: string
          is_demo?: boolean | null
          knows_about?: Json | null
          published_on?: string | null
          slug?: string | null
          title?: string | null
          topic?: string | null
        }
        Relationships: []
      }
      exp_web_ads: {
        Row: {
          budget: number | null
          context: string | null
          created_at: string | null
          creative: Json | null
          ends_on: string | null
          id: string
          name: string | null
          placement: string | null
          spend: number | null
          starts_on: string | null
          status: string | null
          target_gcid: string | null
          target_geo: string | null
        }
        Insert: {
          budget?: number | null
          context?: string | null
          created_at?: string | null
          creative?: Json | null
          ends_on?: string | null
          id?: string
          name?: string | null
          placement?: string | null
          spend?: number | null
          starts_on?: string | null
          status?: string | null
          target_gcid?: string | null
          target_geo?: string | null
        }
        Update: {
          budget?: number | null
          context?: string | null
          created_at?: string | null
          creative?: Json | null
          ends_on?: string | null
          id?: string
          name?: string | null
          placement?: string | null
          spend?: number | null
          starts_on?: string | null
          status?: string | null
          target_gcid?: string | null
          target_geo?: string | null
        }
        Relationships: []
      }
      exp_web_alerts: {
        Row: {
          active: boolean | null
          alert_type: string | null
          created_at: string | null
          id: string
          message: string | null
        }
        Insert: {
          active?: boolean | null
          alert_type?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
        }
        Update: {
          active?: boolean | null
          alert_type?: string | null
          created_at?: string | null
          id?: string
          message?: string | null
        }
        Relationships: []
      }
      exp_web_campaigns: {
        Row: {
          assigned_profiles: number | null
          channel: string | null
          cohort: string | null
          created_at: string | null
          id: string
          name: string | null
          starts_on: string | null
          status: string | null
        }
        Insert: {
          assigned_profiles?: number | null
          channel?: string | null
          cohort?: string | null
          created_at?: string | null
          id?: string
          name?: string | null
          starts_on?: string | null
          status?: string | null
        }
        Update: {
          assigned_profiles?: number | null
          channel?: string | null
          cohort?: string | null
          created_at?: string | null
          id?: string
          name?: string | null
          starts_on?: string | null
          status?: string | null
        }
        Relationships: []
      }
      exp_web_consent_config: {
        Row: {
          analytics_default: boolean
          banner_enabled: boolean
          banner_message: string
          banner_title: string
          id: string
          marketing_default: boolean
          policy_url: string | null
          updated_at: string
        }
        Insert: {
          analytics_default?: boolean
          banner_enabled?: boolean
          banner_message?: string
          banner_title?: string
          id?: string
          marketing_default?: boolean
          policy_url?: string | null
          updated_at?: string
        }
        Update: {
          analytics_default?: boolean
          banner_enabled?: boolean
          banner_message?: string
          banner_title?: string
          id?: string
          marketing_default?: boolean
          policy_url?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      exp_web_consent_events: {
        Row: {
          analytics: boolean | null
          created_at: string | null
          id: string
          marketing: boolean | null
          necessary: boolean | null
          region: string | null
          visitor_id: string | null
        }
        Insert: {
          analytics?: boolean | null
          created_at?: string | null
          id?: string
          marketing?: boolean | null
          necessary?: boolean | null
          region?: string | null
          visitor_id?: string | null
        }
        Update: {
          analytics?: boolean | null
          created_at?: string | null
          id?: string
          marketing?: boolean | null
          necessary?: boolean | null
          region?: string | null
          visitor_id?: string | null
        }
        Relationships: []
      }
      exp_web_forms: {
        Row: {
          active: boolean | null
          created_at: string | null
          destination: string | null
          fields: Json | null
          id: string
          name: string | null
          slug: string | null
        }
        Insert: {
          active?: boolean | null
          created_at?: string | null
          destination?: string | null
          fields?: Json | null
          id?: string
          name?: string | null
          slug?: string | null
        }
        Update: {
          active?: boolean | null
          created_at?: string | null
          destination?: string | null
          fields?: Json | null
          id?: string
          name?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      exp_web_leads: {
        Row: {
          assigned_at: string | null
          assigned_to: string | null
          cohort: string | null
          company: string | null
          created_at: string | null
          email: string | null
          first_touch: string | null
          form_slug: string | null
          id: string
          last_touch: string | null
          message: string | null
          name: string | null
          phone: string | null
          status: string | null
          utm: Json | null
        }
        Insert: {
          assigned_at?: string | null
          assigned_to?: string | null
          cohort?: string | null
          company?: string | null
          created_at?: string | null
          email?: string | null
          first_touch?: string | null
          form_slug?: string | null
          id?: string
          last_touch?: string | null
          message?: string | null
          name?: string | null
          phone?: string | null
          status?: string | null
          utm?: Json | null
        }
        Update: {
          assigned_at?: string | null
          assigned_to?: string | null
          cohort?: string | null
          company?: string | null
          created_at?: string | null
          email?: string | null
          first_touch?: string | null
          form_slug?: string | null
          id?: string
          last_touch?: string | null
          message?: string | null
          name?: string | null
          phone?: string | null
          status?: string | null
          utm?: Json | null
        }
        Relationships: []
      }
      exp_web_media: {
        Row: {
          created_at: string | null
          form_slug: string | null
          gated: boolean | null
          id: string
          media_type: string | null
          title: string | null
          url: string | null
        }
        Insert: {
          created_at?: string | null
          form_slug?: string | null
          gated?: boolean | null
          id?: string
          media_type?: string | null
          title?: string | null
          url?: string | null
        }
        Update: {
          created_at?: string | null
          form_slug?: string | null
          gated?: boolean | null
          id?: string
          media_type?: string | null
          title?: string | null
          url?: string | null
        }
        Relationships: []
      }
      exp_web_nav_menus: {
        Row: {
          assigned_site: string | null
          created_at: string
          created_by: string | null
          deleted_at: string | null
          deleted_by: string | null
          design_tag: string
          id: string
          items: Json
          menu_type: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          assigned_site?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          design_tag?: string
          id?: string
          items?: Json
          menu_type: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          assigned_site?: string | null
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          design_tag?: string
          id?: string
          items?: Json
          menu_type?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      exp_web_page_templates: {
        Row: {
          body: Json
          created_at: string
          created_by: string
          created_by_label: string | null
          deleted_at: string | null
          deleted_by: string | null
          design_tag: string
          id: string
          name: string
          page_settings: Json
          section_indexes: number[]
          source_page_id: string | null
          source_page_title: string | null
          template_kind: string
          updated_at: string
        }
        Insert: {
          body?: Json
          created_at?: string
          created_by: string
          created_by_label?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          design_tag?: string
          id?: string
          name: string
          page_settings?: Json
          section_indexes?: number[]
          source_page_id?: string | null
          source_page_title?: string | null
          template_kind: string
          updated_at?: string
        }
        Update: {
          body?: Json
          created_at?: string
          created_by?: string
          created_by_label?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          design_tag?: string
          id?: string
          name?: string
          page_settings?: Json
          section_indexes?: number[]
          source_page_id?: string | null
          source_page_title?: string | null
          template_kind?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_web_page_templates_source_page_id_fkey"
            columns: ["source_page_id"]
            isOneToOne: false
            referencedRelation: "exp_web_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_web_pages: {
        Row: {
          body: Json | null
          code_rendered: boolean
          created_at: string | null
          deleted_at: string | null
          deleted_by: string | null
          design_tag: string
          id: string
          page_type: string | null
          published_at: string | null
          route_path: string | null
          seo_desc: string | null
          seo_title: string | null
          slug: string | null
          status: string | null
          template_id: string | null
          title: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          body?: Json | null
          code_rendered?: boolean
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          design_tag?: string
          id?: string
          page_type?: string | null
          published_at?: string | null
          route_path?: string | null
          seo_desc?: string | null
          seo_title?: string | null
          slug?: string | null
          status?: string | null
          template_id?: string | null
          title?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          body?: Json | null
          code_rendered?: boolean
          created_at?: string | null
          deleted_at?: string | null
          deleted_by?: string | null
          design_tag?: string
          id?: string
          page_type?: string | null
          published_at?: string | null
          route_path?: string | null
          seo_desc?: string | null
          seo_title?: string | null
          slug?: string | null
          status?: string | null
          template_id?: string | null
          title?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_web_pages_template_id_fkey"
            columns: ["template_id"]
            isOneToOne: false
            referencedRelation: "exp_web_page_templates"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_web_trust_items: {
        Row: {
          body: string | null
          category: string | null
          doc_url: string | null
          id: string
          sort_order: number | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          body?: string | null
          category?: string | null
          doc_url?: string | null
          id?: string
          sort_order?: number | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          body?: string | null
          category?: string | null
          doc_url?: string | null
          id?: string
          sort_order?: number | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      exp_wiki_comments: {
        Row: {
          author: string
          body: string
          created_at: string
          doc_id: string
          id: string
          parent_id: string | null
          resolved: boolean
        }
        Insert: {
          author?: string
          body: string
          created_at?: string
          doc_id: string
          id?: string
          parent_id?: string | null
          resolved?: boolean
        }
        Update: {
          author?: string
          body?: string
          created_at?: string
          doc_id?: string
          id?: string
          parent_id?: string | null
          resolved?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "exp_wiki_comments_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "exp_wiki_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_wiki_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "exp_wiki_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_wiki_docs: {
        Row: {
          author: string
          body_md: string
          category: string
          created_at: string
          id: string
          is_pinned: boolean
          parent_id: string | null
          search_tsv: unknown
          slug: string
          sort_order: number
          source_file: string | null
          space_id: string | null
          status: string
          summary: string | null
          tags: string[]
          title: string
          updated_at: string
          word_count: number
        }
        Insert: {
          author?: string
          body_md?: string
          category?: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          parent_id?: string | null
          search_tsv?: unknown
          slug: string
          sort_order?: number
          source_file?: string | null
          space_id?: string | null
          status?: string
          summary?: string | null
          tags?: string[]
          title: string
          updated_at?: string
          word_count?: number
        }
        Update: {
          author?: string
          body_md?: string
          category?: string
          created_at?: string
          id?: string
          is_pinned?: boolean
          parent_id?: string | null
          search_tsv?: unknown
          slug?: string
          sort_order?: number
          source_file?: string | null
          space_id?: string | null
          status?: string
          summary?: string | null
          tags?: string[]
          title?: string
          updated_at?: string
          word_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "exp_wiki_docs_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "exp_wiki_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_wiki_docs_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "exp_wiki_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_wiki_revisions: {
        Row: {
          body_md: string | null
          category: string | null
          created_at: string
          doc_id: string
          edited_by: string | null
          id: string
          summary: string | null
          title: string | null
        }
        Insert: {
          body_md?: string | null
          category?: string | null
          created_at?: string
          doc_id: string
          edited_by?: string | null
          id?: string
          summary?: string | null
          title?: string | null
        }
        Update: {
          body_md?: string | null
          category?: string | null
          created_at?: string
          doc_id?: string
          edited_by?: string | null
          id?: string
          summary?: string | null
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_wiki_revisions_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "exp_wiki_docs"
            referencedColumns: ["id"]
          },
        ]
      }
      exp_wiki_spaces: {
        Row: {
          color: string | null
          created_at: string
          description: string | null
          icon: string | null
          id: string
          is_archived: boolean
          key: string
          name: string
          owner: string | null
          sort_order: number
          team_key: string | null
          updated_at: string
        }
        Insert: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          key: string
          name: string
          owner?: string | null
          sort_order?: number
          team_key?: string | null
          updated_at?: string
        }
        Update: {
          color?: string | null
          created_at?: string
          description?: string | null
          icon?: string | null
          id?: string
          is_archived?: boolean
          key?: string
          name?: string
          owner?: string | null
          sort_order?: number
          team_key?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      exp_wiki_watchers: {
        Row: {
          created_at: string
          doc_id: string | null
          id: string
          space_id: string | null
          user_ref: string
        }
        Insert: {
          created_at?: string
          doc_id?: string | null
          id?: string
          space_id?: string | null
          user_ref: string
        }
        Update: {
          created_at?: string
          doc_id?: string | null
          id?: string
          space_id?: string | null
          user_ref?: string
        }
        Relationships: [
          {
            foreignKeyName: "exp_wiki_watchers_doc_id_fkey"
            columns: ["doc_id"]
            isOneToOne: false
            referencedRelation: "exp_wiki_docs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "exp_wiki_watchers_space_id_fkey"
            columns: ["space_id"]
            isOneToOne: false
            referencedRelation: "exp_wiki_spaces"
            referencedColumns: ["id"]
          },
        ]
      }
      gbp_categories: {
        Row: {
          created_at: string | null
          display_name: string
          entity_type: string | null
          estimate_confidence: string | null
          estimate_source: string | null
          estimate_updated_at: string | null
          estimated_locations: number | null
          estimated_profiles: number | null
          fetched_at: string
          gcid: string
          is_launched: boolean | null
          more_hours_types: Json | null
          priority_tier: number | null
          refresh_by: string
          service_types: Json | null
          slug: string
          status: string
          supports_single_pro_office: boolean
          updated_at: string | null
          us_relevance: string | null
        }
        Insert: {
          created_at?: string | null
          display_name: string
          entity_type?: string | null
          estimate_confidence?: string | null
          estimate_source?: string | null
          estimate_updated_at?: string | null
          estimated_locations?: number | null
          estimated_profiles?: number | null
          fetched_at?: string
          gcid: string
          is_launched?: boolean | null
          more_hours_types?: Json | null
          priority_tier?: number | null
          refresh_by?: string
          service_types?: Json | null
          slug: string
          status?: string
          supports_single_pro_office?: boolean
          updated_at?: string | null
          us_relevance?: string | null
        }
        Update: {
          created_at?: string | null
          display_name?: string
          entity_type?: string | null
          estimate_confidence?: string | null
          estimate_source?: string | null
          estimate_updated_at?: string | null
          estimated_locations?: number | null
          estimated_profiles?: number | null
          fetched_at?: string
          gcid?: string
          is_launched?: boolean | null
          more_hours_types?: Json | null
          priority_tier?: number | null
          refresh_by?: string
          service_types?: Json | null
          slug?: string
          status?: string
          supports_single_pro_office?: boolean
          updated_at?: string | null
          us_relevance?: string | null
        }
        Relationships: []
      }
      gbp_category_changes: {
        Row: {
          change_detail: Json | null
          change_type: string
          detected_at: string | null
          display_name: string | null
          gcid: string
          id: string
          reviewed: boolean | null
          reviewed_at: string | null
          reviewed_by: string | null
        }
        Insert: {
          change_detail?: Json | null
          change_type: string
          detected_at?: string | null
          display_name?: string | null
          gcid: string
          id?: string
          reviewed?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Update: {
          change_detail?: Json | null
          change_type?: string
          detected_at?: string | null
          display_name?: string | null
          gcid?: string
          id?: string
          reviewed?: boolean | null
          reviewed_at?: string | null
          reviewed_by?: string | null
        }
        Relationships: []
      }
      graph_edges: {
        Row: {
          confidence: number | null
          created_at: string | null
          edge_type: string
          from_entity_id: string | null
          from_entity_type: string | null
          from_node_id: string
          id: string
          relationship_type: string | null
          schema_property: string | null
          source: string | null
          status: string | null
          to_entity_id: string | null
          to_entity_type: string | null
          to_node_id: string
          verified: boolean | null
          weight: number | null
        }
        Insert: {
          confidence?: number | null
          created_at?: string | null
          edge_type: string
          from_entity_id?: string | null
          from_entity_type?: string | null
          from_node_id: string
          id?: string
          relationship_type?: string | null
          schema_property?: string | null
          source?: string | null
          status?: string | null
          to_entity_id?: string | null
          to_entity_type?: string | null
          to_node_id: string
          verified?: boolean | null
          weight?: number | null
        }
        Update: {
          confidence?: number | null
          created_at?: string | null
          edge_type?: string
          from_entity_id?: string | null
          from_entity_type?: string | null
          from_node_id?: string
          id?: string
          relationship_type?: string | null
          schema_property?: string | null
          source?: string | null
          status?: string | null
          to_entity_id?: string | null
          to_entity_type?: string | null
          to_node_id?: string
          verified?: boolean | null
          weight?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "graph_edges_from_node_id_fkey"
            columns: ["from_node_id"]
            isOneToOne: false
            referencedRelation: "graph_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "graph_edges_to_node_id_fkey"
            columns: ["to_node_id"]
            isOneToOne: false
            referencedRelation: "graph_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      graph_nodes: {
        Row: {
          created_at: string | null
          entity_id: string
          entity_type: string
          extracted_data: Json | null
          fetched_at: string | null
          id: string
          is_active: boolean | null
          node_registry_id: string | null
          node_type: string
          raw_data: Json | null
          refresh_by: string | null
          refresh_required: boolean | null
          ring: number
          ring_key: string
          ring_layer: string | null
          schema_property: string | null
          schema_type: string | null
          score_counted: boolean | null
          score_points: number | null
          source: string
          source_id: string | null
          source_url: string | null
          title: string | null
          trust_tier: string | null
          updated_at: string | null
          url: string | null
          value_hash: string | null
          verified: boolean | null
          verified_at: string | null
          verified_by: string | null
        }
        Insert: {
          created_at?: string | null
          entity_id: string
          entity_type: string
          extracted_data?: Json | null
          fetched_at?: string | null
          id?: string
          is_active?: boolean | null
          node_registry_id?: string | null
          node_type: string
          raw_data?: Json | null
          refresh_by?: string | null
          refresh_required?: boolean | null
          ring: number
          ring_key: string
          ring_layer?: string | null
          schema_property?: string | null
          schema_type?: string | null
          score_counted?: boolean | null
          score_points?: number | null
          source: string
          source_id?: string | null
          source_url?: string | null
          title?: string | null
          trust_tier?: string | null
          updated_at?: string | null
          url?: string | null
          value_hash?: string | null
          verified?: boolean | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Update: {
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          extracted_data?: Json | null
          fetched_at?: string | null
          id?: string
          is_active?: boolean | null
          node_registry_id?: string | null
          node_type?: string
          raw_data?: Json | null
          refresh_by?: string | null
          refresh_required?: boolean | null
          ring?: number
          ring_key?: string
          ring_layer?: string | null
          schema_property?: string | null
          schema_type?: string | null
          score_counted?: boolean | null
          score_points?: number | null
          source?: string
          source_id?: string | null
          source_url?: string | null
          title?: string | null
          trust_tier?: string | null
          updated_at?: string | null
          url?: string | null
          value_hash?: string | null
          verified?: boolean | null
          verified_at?: string | null
          verified_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "graph_nodes_node_registry_id_fkey"
            columns: ["node_registry_id"]
            isOneToOne: false
            referencedRelation: "exp_vertical_node_registry"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "graph_nodes_ring_fk"
            columns: ["ring_key"]
            isOneToOne: false
            referencedRelation: "exp_ring"
            referencedColumns: ["ring_key"]
          },
        ]
      }
      graph_rings: {
        Row: {
          color: string
          name: string
          ring: number
          sort: number
        }
        Insert: {
          color: string
          name: string
          ring: number
          sort: number
        }
        Update: {
          color?: string
          name?: string
          ring?: number
          sort?: number
        }
        Relationships: []
      }
      index_intelligence: {
        Row: {
          avg_position: number | null
          clicks_28d: number | null
          coverage_state: string | null
          entity_id: string
          entity_type: string
          id: string
          impressions_28d: number | null
          index_status: string | null
          indexed: boolean | null
          indexed_at: string | null
          last_crawled_at: string | null
          page_type: string
          page_url: string
          sitemap_included: boolean | null
          submitted_at: string | null
          updated_at: string | null
        }
        Insert: {
          avg_position?: number | null
          clicks_28d?: number | null
          coverage_state?: string | null
          entity_id: string
          entity_type: string
          id?: string
          impressions_28d?: number | null
          index_status?: string | null
          indexed?: boolean | null
          indexed_at?: string | null
          last_crawled_at?: string | null
          page_type: string
          page_url: string
          sitemap_included?: boolean | null
          submitted_at?: string | null
          updated_at?: string | null
        }
        Update: {
          avg_position?: number | null
          clicks_28d?: number | null
          coverage_state?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          impressions_28d?: number | null
          index_status?: string | null
          indexed?: boolean | null
          indexed_at?: string | null
          last_crawled_at?: string | null
          page_type?: string
          page_url?: string
          sitemap_included?: boolean | null
          submitted_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      invitations: {
        Row: {
          accepted_at: string | null
          created_at: string | null
          email: string
          entity_id: string
          entity_type: string
          expires_at: string | null
          full_name: string | null
          id: string
          invited_at: string | null
          invited_by: string | null
          prefill_data: Json | null
          role: string
          status: string | null
          token: string
        }
        Insert: {
          accepted_at?: string | null
          created_at?: string | null
          email: string
          entity_id: string
          entity_type: string
          expires_at?: string | null
          full_name?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          prefill_data?: Json | null
          role: string
          status?: string | null
          token?: string
        }
        Update: {
          accepted_at?: string | null
          created_at?: string | null
          email?: string
          entity_id?: string
          entity_type?: string
          expires_at?: string | null
          full_name?: string | null
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          prefill_data?: Json | null
          role?: string
          status?: string | null
          token?: string
        }
        Relationships: [
          {
            foreignKeyName: "invitations_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      listings: {
        Row: {
          address_match: boolean | null
          created_at: string | null
          data_hash: string | null
          directory_key: string
          directory_name: string
          directory_url: string | null
          drift_fields: string[] | null
          entity_id: string
          entity_type: string
          external_id: string | null
          graph_node_id: string | null
          has_drift: boolean | null
          id: string
          last_submitted: string | null
          last_verified: string | null
          listing_url: string | null
          name_match: boolean | null
          phone_match: boolean | null
          score_points: number | null
          status: string
          updated_at: string | null
        }
        Insert: {
          address_match?: boolean | null
          created_at?: string | null
          data_hash?: string | null
          directory_key: string
          directory_name: string
          directory_url?: string | null
          drift_fields?: string[] | null
          entity_id: string
          entity_type: string
          external_id?: string | null
          graph_node_id?: string | null
          has_drift?: boolean | null
          id?: string
          last_submitted?: string | null
          last_verified?: string | null
          listing_url?: string | null
          name_match?: boolean | null
          phone_match?: boolean | null
          score_points?: number | null
          status: string
          updated_at?: string | null
        }
        Update: {
          address_match?: boolean | null
          created_at?: string | null
          data_hash?: string | null
          directory_key?: string
          directory_name?: string
          directory_url?: string | null
          drift_fields?: string[] | null
          entity_id?: string
          entity_type?: string
          external_id?: string | null
          graph_node_id?: string | null
          has_drift?: boolean | null
          id?: string
          last_submitted?: string | null
          last_verified?: string | null
          listing_url?: string | null
          name_match?: boolean | null
          phone_match?: boolean | null
          score_points?: number | null
          status?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "listings_graph_node_id_fkey"
            columns: ["graph_node_id"]
            isOneToOne: false
            referencedRelation: "graph_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      media_items: {
        Row: {
          created_at: string | null
          description: string | null
          duration_seconds: number | null
          embed_url: string | null
          entity_id: string
          entity_type: string
          graph_node_id: string | null
          id: string
          is_active: boolean | null
          media_type: string
          published_at: string | null
          schema_type: string | null
          series_id: string | null
          source_id: string | null
          source_platform: string | null
          source_url: string | null
          tags_extracted: string[] | null
          thumbnail_url: string | null
          title: string
          topics_extracted: string[] | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          embed_url?: string | null
          entity_id: string
          entity_type: string
          graph_node_id?: string | null
          id?: string
          is_active?: boolean | null
          media_type: string
          published_at?: string | null
          schema_type?: string | null
          series_id?: string | null
          source_id?: string | null
          source_platform?: string | null
          source_url?: string | null
          tags_extracted?: string[] | null
          thumbnail_url?: string | null
          title: string
          topics_extracted?: string[] | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          duration_seconds?: number | null
          embed_url?: string | null
          entity_id?: string
          entity_type?: string
          graph_node_id?: string | null
          id?: string
          is_active?: boolean | null
          media_type?: string
          published_at?: string | null
          schema_type?: string | null
          series_id?: string | null
          source_id?: string | null
          source_platform?: string | null
          source_url?: string | null
          tags_extracted?: string[] | null
          thumbnail_url?: string | null
          title?: string
          topics_extracted?: string[] | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "media_items_graph_node_id_fkey"
            columns: ["graph_node_id"]
            isOneToOne: false
            referencedRelation: "graph_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "media_items_series_id_fkey"
            columns: ["series_id"]
            isOneToOne: false
            referencedRelation: "media_items"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_connections: {
        Row: {
          access_token: string | null
          connected_at: string | null
          created_at: string | null
          enables: string[] | null
          entity_id: string
          entity_type: string
          id: string
          is_active: boolean | null
          last_sync_at: string | null
          provider: string
          provider_account_id: string
          provider_email: string | null
          provider_name: string | null
          refresh_token: string | null
          scopes: string[] | null
          sync_count: number | null
          sync_error: string | null
          sync_status: string | null
          token_expires_at: string | null
        }
        Insert: {
          access_token?: string | null
          connected_at?: string | null
          created_at?: string | null
          enables?: string[] | null
          entity_id: string
          entity_type: string
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          provider: string
          provider_account_id: string
          provider_email?: string | null
          provider_name?: string | null
          refresh_token?: string | null
          scopes?: string[] | null
          sync_count?: number | null
          sync_error?: string | null
          sync_status?: string | null
          token_expires_at?: string | null
        }
        Update: {
          access_token?: string | null
          connected_at?: string | null
          created_at?: string | null
          enables?: string[] | null
          entity_id?: string
          entity_type?: string
          id?: string
          is_active?: boolean | null
          last_sync_at?: string | null
          provider?: string
          provider_account_id?: string
          provider_email?: string | null
          provider_name?: string | null
          refresh_token?: string | null
          scopes?: string[] | null
          sync_count?: number | null
          sync_error?: string | null
          sync_status?: string | null
          token_expires_at?: string | null
        }
        Relationships: []
      }
      onboarding_progress: {
        Row: {
          completed_at: string | null
          current_step: number | null
          entity_id: string
          entity_type: string
          id: string
          is_complete: boolean | null
          last_active_at: string | null
          started_at: string | null
          steps_completed: string[] | null
          steps_skipped: string[] | null
          user_id: string
        }
        Insert: {
          completed_at?: string | null
          current_step?: number | null
          entity_id: string
          entity_type: string
          id?: string
          is_complete?: boolean | null
          last_active_at?: string | null
          started_at?: string | null
          steps_completed?: string[] | null
          steps_skipped?: string[] | null
          user_id: string
        }
        Update: {
          completed_at?: string | null
          current_step?: number | null
          entity_id?: string
          entity_type?: string
          id?: string
          is_complete?: boolean | null
          last_active_at?: string | null
          started_at?: string | null
          steps_completed?: string[] | null
          steps_skipped?: string[] | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "onboarding_progress_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          account_tier: string | null
          address_city: string | null
          address_country: string | null
          address_state: string | null
          address_street: string | null
          address_zip: string | null
          canonical_url: string | null
          claimed: boolean | null
          claimed_at: string | null
          cover_photo_url: string | null
          created_at: string | null
          description: string | null
          email: string | null
          entity_type: string | null
          gbp_cid: string | null
          gbp_connected: boolean | null
          gbp_last_sync: string | null
          gbp_place_id: string | null
          gcid: string | null
          hierarchy_depth: number | null
          hierarchy_path: string | null
          id: string
          is_active: boolean | null
          is_demo: boolean
          is_single_pro_office: boolean | null
          latitude: number | null
          legal_name: string | null
          logo_url: string | null
          longitude: number | null
          name: string
          parent_org_id: string | null
          phone: string | null
          same_as: string[] | null
          schema_type: string | null
          score_updated_at: string | null
          search_rank_score: number | null
          short_description: string | null
          slug: string
          territory_id: string | null
          updated_at: string | null
          website_url: string | null
          wikidata_id: string | null
        }
        Insert: {
          account_tier?: string | null
          address_city?: string | null
          address_country?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          canonical_url?: string | null
          claimed?: boolean | null
          claimed_at?: string | null
          cover_photo_url?: string | null
          created_at?: string | null
          description?: string | null
          email?: string | null
          entity_type?: string | null
          gbp_cid?: string | null
          gbp_connected?: boolean | null
          gbp_last_sync?: string | null
          gbp_place_id?: string | null
          gcid?: string | null
          hierarchy_depth?: number | null
          hierarchy_path?: string | null
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          is_single_pro_office?: boolean | null
          latitude?: number | null
          legal_name?: string | null
          logo_url?: string | null
          longitude?: number | null
          name: string
          parent_org_id?: string | null
          phone?: string | null
          same_as?: string[] | null
          schema_type?: string | null
          score_updated_at?: string | null
          search_rank_score?: number | null
          short_description?: string | null
          slug: string
          territory_id?: string | null
          updated_at?: string | null
          website_url?: string | null
          wikidata_id?: string | null
        }
        Update: {
          account_tier?: string | null
          address_city?: string | null
          address_country?: string | null
          address_state?: string | null
          address_street?: string | null
          address_zip?: string | null
          canonical_url?: string | null
          claimed?: boolean | null
          claimed_at?: string | null
          cover_photo_url?: string | null
          created_at?: string | null
          description?: string | null
          email?: string | null
          entity_type?: string | null
          gbp_cid?: string | null
          gbp_connected?: boolean | null
          gbp_last_sync?: string | null
          gbp_place_id?: string | null
          gcid?: string | null
          hierarchy_depth?: number | null
          hierarchy_path?: string | null
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          is_single_pro_office?: boolean | null
          latitude?: number | null
          legal_name?: string | null
          logo_url?: string | null
          longitude?: number | null
          name?: string
          parent_org_id?: string | null
          phone?: string | null
          same_as?: string[] | null
          schema_type?: string | null
          score_updated_at?: string | null
          search_rank_score?: number | null
          short_description?: string | null
          slug?: string
          territory_id?: string | null
          updated_at?: string | null
          website_url?: string | null
          wikidata_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "organizations_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "organizations_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "organizations_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "organizations_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "organizations_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "organizations_parent_org_id_fkey"
            columns: ["parent_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      plg_events: {
        Row: {
          conversion_type: string | null
          converted_at: string | null
          dismissed_at: string | null
          entity_id: string
          entity_type: string
          fired_at: string | null
          id: string
          rule_id: string
        }
        Insert: {
          conversion_type?: string | null
          converted_at?: string | null
          dismissed_at?: string | null
          entity_id: string
          entity_type: string
          fired_at?: string | null
          id?: string
          rule_id: string
        }
        Update: {
          conversion_type?: string | null
          converted_at?: string | null
          dismissed_at?: string | null
          entity_id?: string
          entity_type?: string
          fired_at?: string | null
          id?: string
          rule_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plg_events_rule_id_fkey"
            columns: ["rule_id"]
            isOneToOne: false
            referencedRelation: "plg_rules"
            referencedColumns: ["id"]
          },
        ]
      }
      plg_rules: {
        Row: {
          body: string
          created_at: string | null
          cta_action: string
          cta_text: string
          cta_url: string | null
          gcid: string | null
          headline: string
          icon: string | null
          id: string
          is_active: boolean | null
          priority: number | null
          requires_upgrade: boolean | null
          rule_name: string
          rule_type: string
          trigger_condition: Json
          upgrade_tier: string | null
        }
        Insert: {
          body: string
          created_at?: string | null
          cta_action: string
          cta_text: string
          cta_url?: string | null
          gcid?: string | null
          headline: string
          icon?: string | null
          id?: string
          is_active?: boolean | null
          priority?: number | null
          requires_upgrade?: boolean | null
          rule_name: string
          rule_type: string
          trigger_condition: Json
          upgrade_tier?: string | null
        }
        Update: {
          body?: string
          created_at?: string | null
          cta_action?: string
          cta_text?: string
          cta_url?: string | null
          gcid?: string | null
          headline?: string
          icon?: string | null
          id?: string
          is_active?: boolean | null
          priority?: number | null
          requires_upgrade?: boolean | null
          rule_name?: string
          rule_type?: string
          trigger_condition?: Json
          upgrade_tier?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "plg_rules_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "plg_rules_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "plg_rules_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "plg_rules_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "plg_rules_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "plg_rules_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      professional_org_memberships: {
        Row: {
          created_at: string | null
          end_date: string | null
          id: string
          is_primary: boolean | null
          org_id: string
          professional_id: string
          role: string | null
          start_date: string | null
        }
        Insert: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          is_primary?: boolean | null
          org_id: string
          professional_id: string
          role?: string | null
          start_date?: string | null
        }
        Update: {
          created_at?: string | null
          end_date?: string | null
          id?: string
          is_primary?: boolean | null
          org_id?: string
          professional_id?: string
          role?: string | null
          start_date?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professional_org_memberships_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_org_memberships_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_org_memberships_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "v_compliance_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_org_memberships_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "v_plg_next_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professional_org_memberships_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "v_professional_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      professionals: {
        Row: {
          address_city: string | null
          address_state: string | null
          address_zip: string | null
          bio: string | null
          canonical_url: string | null
          claim_confidence: number | null
          claim_method: string | null
          claimed: boolean | null
          claimed_at: string | null
          compliance_complete: boolean | null
          compliance_score: number | null
          cover_photo_url: string | null
          created_at: string | null
          detail_url: string | null
          display_name: string | null
          email: string | null
          first_name: string
          gbp_connected: boolean | null
          gbp_last_sync: string | null
          gbp_place_id: string | null
          gcid: string | null
          headline: string | null
          id: string
          is_active: boolean | null
          is_demo: boolean
          job_title: string | null
          languages: string[] | null
          last_name: string
          local_rank: number | null
          local_rank_of: number | null
          local_rank_updated: string | null
          markets_served: string[] | null
          nodalized_at: string | null
          phone: string | null
          photo_url: string | null
          primary_license_number: string | null
          primary_license_state: string | null
          primary_license_type: string | null
          primary_license_verified: boolean | null
          primary_license_verified_at: string | null
          primary_org_id: string | null
          same_as: string[] | null
          schema_type: string | null
          score_updated_at: string | null
          search_rank_score: number | null
          short_bio: string | null
          slug: string
          territory_id: string | null
          updated_at: string | null
          user_id: string | null
          website_url: string | null
          wikidata_id: string | null
          zip_codes_served: string[] | null
        }
        Insert: {
          address_city?: string | null
          address_state?: string | null
          address_zip?: string | null
          bio?: string | null
          canonical_url?: string | null
          claim_confidence?: number | null
          claim_method?: string | null
          claimed?: boolean | null
          claimed_at?: string | null
          compliance_complete?: boolean | null
          compliance_score?: number | null
          cover_photo_url?: string | null
          created_at?: string | null
          detail_url?: string | null
          display_name?: string | null
          email?: string | null
          first_name: string
          gbp_connected?: boolean | null
          gbp_last_sync?: string | null
          gbp_place_id?: string | null
          gcid?: string | null
          headline?: string | null
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          job_title?: string | null
          languages?: string[] | null
          last_name: string
          local_rank?: number | null
          local_rank_of?: number | null
          local_rank_updated?: string | null
          markets_served?: string[] | null
          nodalized_at?: string | null
          phone?: string | null
          photo_url?: string | null
          primary_license_number?: string | null
          primary_license_state?: string | null
          primary_license_type?: string | null
          primary_license_verified?: boolean | null
          primary_license_verified_at?: string | null
          primary_org_id?: string | null
          same_as?: string[] | null
          schema_type?: string | null
          score_updated_at?: string | null
          search_rank_score?: number | null
          short_bio?: string | null
          slug: string
          territory_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          website_url?: string | null
          wikidata_id?: string | null
          zip_codes_served?: string[] | null
        }
        Update: {
          address_city?: string | null
          address_state?: string | null
          address_zip?: string | null
          bio?: string | null
          canonical_url?: string | null
          claim_confidence?: number | null
          claim_method?: string | null
          claimed?: boolean | null
          claimed_at?: string | null
          compliance_complete?: boolean | null
          compliance_score?: number | null
          cover_photo_url?: string | null
          created_at?: string | null
          detail_url?: string | null
          display_name?: string | null
          email?: string | null
          first_name?: string
          gbp_connected?: boolean | null
          gbp_last_sync?: string | null
          gbp_place_id?: string | null
          gcid?: string | null
          headline?: string | null
          id?: string
          is_active?: boolean | null
          is_demo?: boolean
          job_title?: string | null
          languages?: string[] | null
          last_name?: string
          local_rank?: number | null
          local_rank_of?: number | null
          local_rank_updated?: string | null
          markets_served?: string[] | null
          nodalized_at?: string | null
          phone?: string | null
          photo_url?: string | null
          primary_license_number?: string | null
          primary_license_state?: string | null
          primary_license_type?: string | null
          primary_license_verified?: boolean | null
          primary_license_verified_at?: string | null
          primary_org_id?: string | null
          same_as?: string[] | null
          schema_type?: string | null
          score_updated_at?: string | null
          search_rank_score?: number | null
          short_bio?: string | null
          slug?: string
          territory_id?: string | null
          updated_at?: string | null
          user_id?: string | null
          website_url?: string | null
          wikidata_id?: string | null
          zip_codes_served?: string[] | null
        }
        Relationships: [
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_primary_org_id_fkey"
            columns: ["primary_org_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "professionals_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      review_campaigns: {
        Row: {
          campaign_type: string
          clicked_count: number | null
          completed_count: number | null
          compliance_approved: boolean | null
          created_at: string | null
          entity_id: string
          entity_type: string
          id: string
          includes_required_disclosures: boolean | null
          message_body: string | null
          name: string
          opened_count: number | null
          redirect_url: string | null
          sent_count: number | null
          status: string | null
          subject: string | null
          target_platform: string | null
          updated_at: string | null
        }
        Insert: {
          campaign_type: string
          clicked_count?: number | null
          completed_count?: number | null
          compliance_approved?: boolean | null
          created_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          includes_required_disclosures?: boolean | null
          message_body?: string | null
          name: string
          opened_count?: number | null
          redirect_url?: string | null
          sent_count?: number | null
          status?: string | null
          subject?: string | null
          target_platform?: string | null
          updated_at?: string | null
        }
        Update: {
          campaign_type?: string
          clicked_count?: number | null
          completed_count?: number | null
          compliance_approved?: boolean | null
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          includes_required_disclosures?: boolean | null
          message_body?: string | null
          name?: string
          opened_count?: number | null
          redirect_url?: string | null
          sent_count?: number | null
          status?: string | null
          subject?: string | null
          target_platform?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      reviews: {
        Row: {
          body: string | null
          compliance_checked: boolean | null
          compliance_flags: string[] | null
          compliance_passed: boolean | null
          created_at: string | null
          entity_id: string
          entity_type: string
          flag_reason: string | null
          flag_status: string | null
          graph_node_id: string | null
          id: string
          is_featured: boolean | null
          is_flagged: boolean | null
          is_verified: boolean | null
          keywords_extracted: string[] | null
          locations_mentioned: string[] | null
          rating: number
          reply_body: string | null
          reply_date: string | null
          reply_source: string | null
          review_date: string
          reviewer_name: string | null
          reviewer_photo_url: string | null
          schema_type: string | null
          sentiment: string | null
          sentiment_score: number | null
          services_mentioned: string[] | null
          source: string
          source_review_id: string | null
          source_url: string | null
          title: string | null
          updated_at: string | null
        }
        Insert: {
          body?: string | null
          compliance_checked?: boolean | null
          compliance_flags?: string[] | null
          compliance_passed?: boolean | null
          created_at?: string | null
          entity_id: string
          entity_type: string
          flag_reason?: string | null
          flag_status?: string | null
          graph_node_id?: string | null
          id?: string
          is_featured?: boolean | null
          is_flagged?: boolean | null
          is_verified?: boolean | null
          keywords_extracted?: string[] | null
          locations_mentioned?: string[] | null
          rating: number
          reply_body?: string | null
          reply_date?: string | null
          reply_source?: string | null
          review_date: string
          reviewer_name?: string | null
          reviewer_photo_url?: string | null
          schema_type?: string | null
          sentiment?: string | null
          sentiment_score?: number | null
          services_mentioned?: string[] | null
          source: string
          source_review_id?: string | null
          source_url?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Update: {
          body?: string | null
          compliance_checked?: boolean | null
          compliance_flags?: string[] | null
          compliance_passed?: boolean | null
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          flag_reason?: string | null
          flag_status?: string | null
          graph_node_id?: string | null
          id?: string
          is_featured?: boolean | null
          is_flagged?: boolean | null
          is_verified?: boolean | null
          keywords_extracted?: string[] | null
          locations_mentioned?: string[] | null
          rating?: number
          reply_body?: string | null
          reply_date?: string | null
          reply_source?: string | null
          review_date?: string
          reviewer_name?: string | null
          reviewer_photo_url?: string | null
          schema_type?: string | null
          sentiment?: string | null
          sentiment_score?: number | null
          services_mentioned?: string[] | null
          source?: string
          source_review_id?: string | null
          source_url?: string | null
          title?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "reviews_graph_node_id_fkey"
            columns: ["graph_node_id"]
            isOneToOne: false
            referencedRelation: "graph_nodes"
            referencedColumns: ["id"]
          },
        ]
      }
      schema_cache: {
        Row: {
          entity_id: string
          entity_type: string
          generated_at: string | null
          id: string
          invalidated_at: string | null
          is_valid: boolean | null
          node_count: number | null
          page_type: string
          schema_json: Json
        }
        Insert: {
          entity_id: string
          entity_type: string
          generated_at?: string | null
          id?: string
          invalidated_at?: string | null
          is_valid?: boolean | null
          node_count?: number | null
          page_type: string
          schema_json: Json
        }
        Update: {
          entity_id?: string
          entity_type?: string
          generated_at?: string | null
          id?: string
          invalidated_at?: string | null
          is_valid?: boolean | null
          node_count?: number | null
          page_type?: string
          schema_json?: Json
        }
        Relationships: []
      }
      schema_validation_log: {
        Row: {
          entity_id: string
          entity_type: string
          errors: Json | null
          id: string
          page_type: string
          page_url: string
          result: string | null
          rich_results: string[] | null
          validated_at: string | null
          validation_tool: string | null
          warnings: Json | null
        }
        Insert: {
          entity_id: string
          entity_type: string
          errors?: Json | null
          id?: string
          page_type: string
          page_url: string
          result?: string | null
          rich_results?: string[] | null
          validated_at?: string | null
          validation_tool?: string | null
          warnings?: Json | null
        }
        Update: {
          entity_id?: string
          entity_type?: string
          errors?: Json | null
          id?: string
          page_type?: string
          page_url?: string
          result?: string | null
          rich_results?: string[] | null
          validated_at?: string | null
          validation_tool?: string | null
          warnings?: Json | null
        }
        Relationships: []
      }
      score_history: {
        Row: {
          created_at: string | null
          entity_id: string
          entity_type: string
          id: string
          local_rank: number | null
          score_content: number | null
          score_listings: number | null
          score_profile: number | null
          score_reviews: number | null
          snapshot_date: string
          total_score: number
        }
        Insert: {
          created_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          local_rank?: number | null
          score_content?: number | null
          score_listings?: number | null
          score_profile?: number | null
          score_reviews?: number | null
          snapshot_date?: string
          total_score: number
        }
        Update: {
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          local_rank?: number | null
          score_content?: number | null
          score_listings?: number | null
          score_profile?: number | null
          score_reviews?: number | null
          snapshot_date?: string
          total_score?: number
        }
        Relationships: []
      }
      search_documents: {
        Row: {
          city: string | null
          claimed: boolean | null
          completeness_pct: number | null
          entity_id: string | null
          entity_type: string | null
          fts: unknown
          gcid: string | null
          id: string
          is_demo: boolean | null
          languages: string[] | null
          lat: number | null
          lng: number | null
          name: string | null
          photo_url: string | null
          rank_score: number | null
          rating: number | null
          review_count: number | null
          score_basis: string | null
          slug: string | null
          state: string | null
          title: string | null
          updated_at: string | null
          zip: string | null
        }
        Insert: {
          city?: string | null
          claimed?: boolean | null
          completeness_pct?: number | null
          entity_id?: string | null
          entity_type?: string | null
          fts?: unknown
          gcid?: string | null
          id?: string
          is_demo?: boolean | null
          languages?: string[] | null
          lat?: number | null
          lng?: number | null
          name?: string | null
          photo_url?: string | null
          rank_score?: number | null
          rating?: number | null
          review_count?: number | null
          score_basis?: string | null
          slug?: string | null
          state?: string | null
          title?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Update: {
          city?: string | null
          claimed?: boolean | null
          completeness_pct?: number | null
          entity_id?: string | null
          entity_type?: string | null
          fts?: unknown
          gcid?: string | null
          id?: string
          is_demo?: boolean | null
          languages?: string[] | null
          lat?: number | null
          lng?: number | null
          name?: string | null
          photo_url?: string | null
          rank_score?: number | null
          rating?: number | null
          review_count?: number | null
          score_basis?: string | null
          slug?: string | null
          state?: string | null
          title?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Relationships: []
      }
      search_rank_scores: {
        Row: {
          calculated_at: string | null
          entity_id: string
          entity_type: string
          gaps: Json | null
          gcid: string | null
          id: string
          local_market: string | null
          local_rank: number | null
          local_rank_of: number | null
          max_possible: number
          next_milestone: number | null
          next_milestone_gap: number | null
          previous_score: number | null
          score_change_30d: number | null
          score_change_7d: number | null
          score_connections: number | null
          score_content: number | null
          score_listings: number | null
          score_pct: number | null
          score_profile: number | null
          score_reviews: number | null
          score_web_analytics: number | null
          top_pct: number | null
          total_score: number
        }
        Insert: {
          calculated_at?: string | null
          entity_id: string
          entity_type: string
          gaps?: Json | null
          gcid?: string | null
          id?: string
          local_market?: string | null
          local_rank?: number | null
          local_rank_of?: number | null
          max_possible?: number
          next_milestone?: number | null
          next_milestone_gap?: number | null
          previous_score?: number | null
          score_change_30d?: number | null
          score_change_7d?: number | null
          score_connections?: number | null
          score_content?: number | null
          score_listings?: number | null
          score_pct?: number | null
          score_profile?: number | null
          score_reviews?: number | null
          score_web_analytics?: number | null
          top_pct?: number | null
          total_score?: number
        }
        Update: {
          calculated_at?: string | null
          entity_id?: string
          entity_type?: string
          gaps?: Json | null
          gcid?: string | null
          id?: string
          local_market?: string | null
          local_rank?: number | null
          local_rank_of?: number | null
          max_possible?: number
          next_milestone?: number | null
          next_milestone_gap?: number | null
          previous_score?: number | null
          score_change_30d?: number | null
          score_change_7d?: number | null
          score_connections?: number | null
          score_content?: number | null
          score_listings?: number | null
          score_pct?: number | null
          score_profile?: number | null
          score_reviews?: number | null
          score_web_analytics?: number | null
          top_pct?: number | null
          total_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "search_rank_scores_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "search_rank_scores_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "search_rank_scores_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "search_rank_scores_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "search_rank_scores_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "search_rank_scores_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      sf_frontier: {
        Row: {
          fetched_at: string | null
          id: string
          kind: string | null
          state: string | null
          status: string | null
          url: string | null
        }
        Insert: {
          fetched_at?: string | null
          id?: string
          kind?: string | null
          state?: string | null
          status?: string | null
          url?: string | null
        }
        Update: {
          fetched_at?: string | null
          id?: string
          kind?: string | null
          state?: string | null
          status?: string | null
          url?: string | null
        }
        Relationships: []
      }
      sf_req: {
        Row: {
          created_at: string | null
          frontier_id: string | null
          request_id: number
        }
        Insert: {
          created_at?: string | null
          frontier_id?: string | null
          request_id: number
        }
        Update: {
          created_at?: string | null
          frontier_id?: string | null
          request_id?: number
        }
        Relationships: []
      }
      sfh_frontier: {
        Row: {
          entity_id: string
          fetched_at: string | null
          status: string | null
          url: string | null
        }
        Insert: {
          entity_id: string
          fetched_at?: string | null
          status?: string | null
          url?: string | null
        }
        Update: {
          entity_id?: string
          fetched_at?: string | null
          status?: string | null
          url?: string | null
        }
        Relationships: []
      }
      sfh_req: {
        Row: {
          created_at: string | null
          entity_id: string | null
          request_id: number
        }
        Insert: {
          created_at?: string | null
          entity_id?: string | null
          request_id: number
        }
        Update: {
          created_at?: string | null
          entity_id?: string | null
          request_id?: number
        }
        Relationships: []
      }
      sso_config: {
        Row: {
          attribute_map: Json | null
          client_id: string | null
          client_secret: string | null
          created_at: string | null
          id: string
          is_active: boolean | null
          issuer_url: string | null
          metadata_url: string | null
          org_id: string
          provider: string
        }
        Insert: {
          attribute_map?: Json | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          issuer_url?: string | null
          metadata_url?: string | null
          org_id: string
          provider: string
        }
        Update: {
          attribute_map?: Json | null
          client_id?: string | null
          client_secret?: string | null
          created_at?: string | null
          id?: string
          is_active?: boolean | null
          issuer_url?: string | null
          metadata_url?: string | null
          org_id?: string
          provider?: string
        }
        Relationships: [
          {
            foreignKeyName: "sso_config_org_id_fkey"
            columns: ["org_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      subscriptions: {
        Row: {
          billing_cycle: string | null
          cancel_at: string | null
          canceled_at: string | null
          created_at: string | null
          current_period_end: string | null
          current_period_start: string | null
          entity_id: string
          entity_type: string
          features_included: string[] | null
          id: string
          plan_id: string
          plan_name: string
          status: string | null
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          trial_ends_at: string | null
          updated_at: string | null
        }
        Insert: {
          billing_cycle?: string | null
          cancel_at?: string | null
          canceled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          entity_id: string
          entity_type: string
          features_included?: string[] | null
          id?: string
          plan_id: string
          plan_name: string
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Update: {
          billing_cycle?: string | null
          cancel_at?: string | null
          canceled_at?: string | null
          created_at?: string | null
          current_period_end?: string | null
          current_period_start?: string | null
          entity_id?: string
          entity_type?: string
          features_included?: string[] | null
          id?: string
          plan_id?: string
          plan_name?: string
          status?: string | null
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          trial_ends_at?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      sync_jobs: {
        Row: {
          completed_at: string | null
          created_at: string | null
          duration_ms: number | null
          entity_id: string | null
          entity_type: string | null
          error_log: Json | null
          id: string
          integration_id: string | null
          job_type: string
          records_failed: number | null
          records_processed: number | null
          started_at: string | null
          status: string | null
          triggered_by: string | null
        }
        Insert: {
          completed_at?: string | null
          created_at?: string | null
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          error_log?: Json | null
          id?: string
          integration_id?: string | null
          job_type: string
          records_failed?: number | null
          records_processed?: number | null
          started_at?: string | null
          status?: string | null
          triggered_by?: string | null
        }
        Update: {
          completed_at?: string | null
          created_at?: string | null
          duration_ms?: number | null
          entity_id?: string | null
          entity_type?: string | null
          error_log?: Json | null
          id?: string
          integration_id?: string | null
          job_type?: string
          records_failed?: number | null
          records_processed?: number | null
          started_at?: string | null
          status?: string | null
          triggered_by?: string | null
        }
        Relationships: []
      }
      terms_acceptance: {
        Row: {
          accepted: boolean
          accepted_at: string | null
          document_type: string
          document_version: string
          id: string
          ip_address: unknown
          user_agent: string | null
          user_id: string
        }
        Insert: {
          accepted: boolean
          accepted_at?: string | null
          document_type: string
          document_version: string
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id: string
        }
        Update: {
          accepted?: boolean
          accepted_at?: string | null
          document_type?: string
          document_version?: string
          id?: string
          ip_address?: unknown
          user_agent?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "terms_acceptance_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      transaction_signals: {
        Row: {
          aggregated: boolean | null
          city: string | null
          county: string | null
          created_at: string | null
          graph_node_id: string | null
          id: string
          neighborhood: string | null
          pii_stripped: boolean | null
          price_bucket: string | null
          price_range_high: number | null
          price_range_low: number | null
          professional_id: string
          service_type: string | null
          source: string | null
          source_id: string | null
          state: string | null
          transaction_date: string | null
          transaction_quarter: number | null
          transaction_type: string
          transaction_year: number | null
          zip_code: string | null
        }
        Insert: {
          aggregated?: boolean | null
          city?: string | null
          county?: string | null
          created_at?: string | null
          graph_node_id?: string | null
          id?: string
          neighborhood?: string | null
          pii_stripped?: boolean | null
          price_bucket?: string | null
          price_range_high?: number | null
          price_range_low?: number | null
          professional_id: string
          service_type?: string | null
          source?: string | null
          source_id?: string | null
          state?: string | null
          transaction_date?: string | null
          transaction_quarter?: number | null
          transaction_type: string
          transaction_year?: number | null
          zip_code?: string | null
        }
        Update: {
          aggregated?: boolean | null
          city?: string | null
          county?: string | null
          created_at?: string | null
          graph_node_id?: string | null
          id?: string
          neighborhood?: string | null
          pii_stripped?: boolean | null
          price_bucket?: string | null
          price_range_high?: number | null
          price_range_low?: number | null
          professional_id?: string
          service_type?: string | null
          source?: string | null
          source_id?: string | null
          state?: string | null
          transaction_date?: string | null
          transaction_quarter?: number | null
          transaction_type?: string
          transaction_year?: number | null
          zip_code?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "transaction_signals_graph_node_id_fkey"
            columns: ["graph_node_id"]
            isOneToOne: false
            referencedRelation: "graph_nodes"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_signals_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "professionals"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_signals_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "v_compliance_status"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_signals_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "v_plg_next_actions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "transaction_signals_professional_id_fkey"
            columns: ["professional_id"]
            isOneToOne: false
            referencedRelation: "v_professional_profile"
            referencedColumns: ["id"]
          },
        ]
      }
      user_accounts: {
        Row: {
          avatar_url: string | null
          created_at: string | null
          email: string
          email_verified: boolean | null
          full_name: string | null
          id: string
          is_active: boolean | null
          last_login_at: string | null
          login_count: number | null
          notification_prefs: Json | null
          phone: string | null
          phone_verified: boolean | null
          supabase_user_id: string
          system_role: string
          ui_prefs: Json | null
          updated_at: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string | null
          email: string
          email_verified?: boolean | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          login_count?: number | null
          notification_prefs?: Json | null
          phone?: string | null
          phone_verified?: boolean | null
          supabase_user_id: string
          system_role?: string
          ui_prefs?: Json | null
          updated_at?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string | null
          email?: string
          email_verified?: boolean | null
          full_name?: string | null
          id?: string
          is_active?: boolean | null
          last_login_at?: string | null
          login_count?: number | null
          notification_prefs?: Json | null
          phone?: string | null
          phone_verified?: boolean | null
          supabase_user_id?: string
          system_role?: string
          ui_prefs?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          accepted_at: string | null
          can_edit_profile: boolean | null
          can_login_as: boolean | null
          can_manage_billing: boolean | null
          can_manage_users: boolean | null
          can_publish_content: boolean | null
          can_view_analytics: boolean | null
          created_at: string | null
          entity_id: string
          entity_type: string
          id: string
          invited_at: string | null
          invited_by: string | null
          is_active: boolean | null
          role: string
          user_id: string
        }
        Insert: {
          accepted_at?: string | null
          can_edit_profile?: boolean | null
          can_login_as?: boolean | null
          can_manage_billing?: boolean | null
          can_manage_users?: boolean | null
          can_publish_content?: boolean | null
          can_view_analytics?: boolean | null
          created_at?: string | null
          entity_id: string
          entity_type: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          is_active?: boolean | null
          role: string
          user_id: string
        }
        Update: {
          accepted_at?: string | null
          can_edit_profile?: boolean | null
          can_login_as?: boolean | null
          can_manage_billing?: boolean | null
          can_manage_users?: boolean | null
          can_publish_content?: boolean | null
          can_view_analytics?: boolean | null
          created_at?: string | null
          entity_id?: string
          entity_type?: string
          id?: string
          invited_at?: string | null
          invited_by?: string | null
          is_active?: boolean | null
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_roles_invited_by_fkey"
            columns: ["invited_by"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "user_roles_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "user_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      v_key: {
        Row: {
          anthropic_key: string | null
        }
        Insert: {
          anthropic_key?: string | null
        }
        Update: {
          anthropic_key?: string | null
        }
        Relationships: []
      }
      wikidata_mappings: {
        Row: {
          created_at: string | null
          description: string | null
          gcid_relevance: string[] | null
          id: string
          term: string
          wikidata_id: string
          wikidata_url: string | null
          wikipedia_url: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          gcid_relevance?: string[] | null
          id?: string
          term: string
          wikidata_id: string
          wikidata_url?: string | null
          wikipedia_url?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          gcid_relevance?: string[] | null
          id?: string
          term?: string
          wikidata_id?: string
          wikidata_url?: string | null
          wikipedia_url?: string | null
        }
        Relationships: []
      }
      zz_backup_batch1_compliance: {
        Row: {
          advertising_rules_url: string | null
          age_gate_minimum: number | null
          age_gate_required: boolean | null
          age_gate_type: string | null
          compliance_notes: string | null
          content_restrictions: string[] | null
          coppa_applies: boolean | null
          created_at: string | null
          disclaimer_placement: string[] | null
          display_license_on_ads: boolean | null
          display_license_on_content: boolean | null
          display_license_on_email: boolean | null
          display_license_on_profile: boolean | null
          ferpa_applies: boolean | null
          gcid: string | null
          glba_applies: boolean | null
          hipaa_applies: boolean | null
          license_display_format: string | null
          license_label: string | null
          prohibited_phrases: string[] | null
          regulated_by: string[] | null
          required_disclaimers: string[] | null
          required_disclosures: string[] | null
          review_transaction_required: boolean | null
          review_verification_required: boolean | null
          updated_at: string | null
        }
        Insert: {
          advertising_rules_url?: string | null
          age_gate_minimum?: number | null
          age_gate_required?: boolean | null
          age_gate_type?: string | null
          compliance_notes?: string | null
          content_restrictions?: string[] | null
          coppa_applies?: boolean | null
          created_at?: string | null
          disclaimer_placement?: string[] | null
          display_license_on_ads?: boolean | null
          display_license_on_content?: boolean | null
          display_license_on_email?: boolean | null
          display_license_on_profile?: boolean | null
          ferpa_applies?: boolean | null
          gcid?: string | null
          glba_applies?: boolean | null
          hipaa_applies?: boolean | null
          license_display_format?: string | null
          license_label?: string | null
          prohibited_phrases?: string[] | null
          regulated_by?: string[] | null
          required_disclaimers?: string[] | null
          required_disclosures?: string[] | null
          review_transaction_required?: boolean | null
          review_verification_required?: boolean | null
          updated_at?: string | null
        }
        Update: {
          advertising_rules_url?: string | null
          age_gate_minimum?: number | null
          age_gate_required?: boolean | null
          age_gate_type?: string | null
          compliance_notes?: string | null
          content_restrictions?: string[] | null
          coppa_applies?: boolean | null
          created_at?: string | null
          disclaimer_placement?: string[] | null
          display_license_on_ads?: boolean | null
          display_license_on_content?: boolean | null
          display_license_on_email?: boolean | null
          display_license_on_profile?: boolean | null
          ferpa_applies?: boolean | null
          gcid?: string | null
          glba_applies?: boolean | null
          hipaa_applies?: boolean | null
          license_display_format?: string | null
          license_label?: string | null
          prohibited_phrases?: string[] | null
          regulated_by?: string[] | null
          required_disclaimers?: string[] | null
          required_disclosures?: string[] | null
          review_transaction_required?: boolean | null
          review_verification_required?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      zz_backup_batch1_knowledge: {
        Row: {
          ai_agents: Json | null
          compliance_rules: string[] | null
          content_topics: string[] | null
          conversion_actions: Json | null
          created_at: string | null
          customer_journey: Json | null
          entity_type: string | null
          exclusion_reason: string | null
          expertise_signals: Json | null
          gcid: string | null
          id: string | null
          is_launched: boolean | null
          knowledge_pct: number | null
          pricing_tier: string | null
          ranking_factors: Json | null
          review_vocabulary: string[] | null
          scoring_weights: Json | null
          search_intents: Json | null
          services: Json | null
          status: string | null
          terminology: string[] | null
          updated_at: string | null
          value_props: Json | null
        }
        Insert: {
          ai_agents?: Json | null
          compliance_rules?: string[] | null
          content_topics?: string[] | null
          conversion_actions?: Json | null
          created_at?: string | null
          customer_journey?: Json | null
          entity_type?: string | null
          exclusion_reason?: string | null
          expertise_signals?: Json | null
          gcid?: string | null
          id?: string | null
          is_launched?: boolean | null
          knowledge_pct?: number | null
          pricing_tier?: string | null
          ranking_factors?: Json | null
          review_vocabulary?: string[] | null
          scoring_weights?: Json | null
          search_intents?: Json | null
          services?: Json | null
          status?: string | null
          terminology?: string[] | null
          updated_at?: string | null
          value_props?: Json | null
        }
        Update: {
          ai_agents?: Json | null
          compliance_rules?: string[] | null
          content_topics?: string[] | null
          conversion_actions?: Json | null
          created_at?: string | null
          customer_journey?: Json | null
          entity_type?: string | null
          exclusion_reason?: string | null
          expertise_signals?: Json | null
          gcid?: string | null
          id?: string | null
          is_launched?: boolean | null
          knowledge_pct?: number | null
          pricing_tier?: string | null
          ranking_factors?: Json | null
          review_vocabulary?: string[] | null
          scoring_weights?: Json | null
          search_intents?: Json | null
          services?: Json | null
          status?: string | null
          terminology?: string[] | null
          updated_at?: string | null
          value_props?: Json | null
        }
        Relationships: []
      }
      zz_backup_batch1_registry: {
        Row: {
          compliance_notes: string | null
          connection_method: string | null
          created_at: string | null
          entity_scope: string | null
          gcid: string | null
          id: string | null
          is_active: boolean | null
          node_description: string | null
          node_name: string | null
          node_slug: string | null
          notes: string | null
          priority: number | null
          required_for_score: boolean | null
          ring: string | null
          schema_property: string | null
          schema_type: string | null
          score_points: number | null
          updated_at: string | null
          url_example: string | null
          url_pattern: string | null
        }
        Insert: {
          compliance_notes?: string | null
          connection_method?: string | null
          created_at?: string | null
          entity_scope?: string | null
          gcid?: string | null
          id?: string | null
          is_active?: boolean | null
          node_description?: string | null
          node_name?: string | null
          node_slug?: string | null
          notes?: string | null
          priority?: number | null
          required_for_score?: boolean | null
          ring?: string | null
          schema_property?: string | null
          schema_type?: string | null
          score_points?: number | null
          updated_at?: string | null
          url_example?: string | null
          url_pattern?: string | null
        }
        Update: {
          compliance_notes?: string | null
          connection_method?: string | null
          created_at?: string | null
          entity_scope?: string | null
          gcid?: string | null
          id?: string | null
          is_active?: boolean | null
          node_description?: string | null
          node_name?: string | null
          node_slug?: string | null
          notes?: string | null
          priority?: number | null
          required_for_score?: boolean | null
          ring?: string | null
          schema_property?: string | null
          schema_type?: string | null
          score_points?: number | null
          updated_at?: string | null
          url_example?: string | null
          url_pattern?: string | null
        }
        Relationships: []
      }
      zz_backup_batch1_taxonomy: {
        Row: {
          created_at: string | null
          description: string | null
          entity_scope: string | null
          gcid: string | null
          id: string | null
          is_active: boolean | null
          is_required: boolean | null
          level: string | null
          parent_id: string | null
          priority: number | null
          schema_property: string | null
          schema_type: string | null
          score_weight: number | null
          search_intent: string | null
          search_volume_monthly: number | null
          source: string | null
          term: string | null
          term_display: string | null
          term_slug: string | null
          updated_at: string | null
          use_agents: boolean | null
          use_schema: boolean | null
          use_search: boolean | null
          use_srp: boolean | null
          use_voce: boolean | null
          validated: boolean | null
          wikidata_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          entity_scope?: string | null
          gcid?: string | null
          id?: string | null
          is_active?: boolean | null
          is_required?: boolean | null
          level?: string | null
          parent_id?: string | null
          priority?: number | null
          schema_property?: string | null
          schema_type?: string | null
          score_weight?: number | null
          search_intent?: string | null
          search_volume_monthly?: number | null
          source?: string | null
          term?: string | null
          term_display?: string | null
          term_slug?: string | null
          updated_at?: string | null
          use_agents?: boolean | null
          use_schema?: boolean | null
          use_search?: boolean | null
          use_srp?: boolean | null
          use_voce?: boolean | null
          validated?: boolean | null
          wikidata_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          entity_scope?: string | null
          gcid?: string | null
          id?: string | null
          is_active?: boolean | null
          is_required?: boolean | null
          level?: string | null
          parent_id?: string | null
          priority?: number | null
          schema_property?: string | null
          schema_type?: string | null
          score_weight?: number | null
          search_intent?: string | null
          search_volume_monthly?: number | null
          source?: string | null
          term?: string | null
          term_display?: string | null
          term_slug?: string | null
          updated_at?: string | null
          use_agents?: boolean | null
          use_schema?: boolean | null
          use_search?: boolean | null
          use_srp?: boolean | null
          use_voce?: boolean | null
          validated?: boolean | null
          wikidata_id?: string | null
        }
        Relationships: []
      }
      zz_backup_claim_queue_20261011b: {
        Row: {
          claimant_email: string | null
          claimant_name: string | null
          claimant_user_id: string | null
          confidence_score: number | null
          confidence_signals: Json | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          id: string | null
          match_method: string | null
          review_notes: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string | null
          updated_at: string | null
        }
        Insert: {
          claimant_email?: string | null
          claimant_name?: string | null
          claimant_user_id?: string | null
          confidence_score?: number | null
          confidence_signals?: Json | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          match_method?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Update: {
          claimant_email?: string | null
          claimant_name?: string | null
          claimant_user_id?: string | null
          confidence_score?: number | null
          confidence_signals?: Json | null
          created_at?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          match_method?: string | null
          review_notes?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string | null
          updated_at?: string | null
        }
        Relationships: []
      }
      zz_backup_exp_capability_registry_20261011b: {
        Row: {
          created_at: string | null
          description: string | null
          dry_run: boolean | null
          entitlement_required: string | null
          events_emitted: string[] | null
          id: string | null
          idempotent_key: string | null
          inputs: Json | null
          key: string | null
          outputs: Json | null
          owning_surface: string | null
          reads_state: string[] | null
          side_effects: string[] | null
          status: string | null
          title: string | null
          transport: string | null
          updated_at: string | null
          version: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          dry_run?: boolean | null
          entitlement_required?: string | null
          events_emitted?: string[] | null
          id?: string | null
          idempotent_key?: string | null
          inputs?: Json | null
          key?: string | null
          outputs?: Json | null
          owning_surface?: string | null
          reads_state?: string[] | null
          side_effects?: string[] | null
          status?: string | null
          title?: string | null
          transport?: string | null
          updated_at?: string | null
          version?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          dry_run?: boolean | null
          entitlement_required?: string | null
          events_emitted?: string[] | null
          id?: string | null
          idempotent_key?: string | null
          inputs?: Json | null
          key?: string | null
          outputs?: Json | null
          owning_surface?: string | null
          reads_state?: string[] | null
          side_effects?: string[] | null
          status?: string | null
          title?: string | null
          transport?: string | null
          updated_at?: string | null
          version?: string | null
        }
        Relationships: []
      }
      zz_backup_exp_claim_20261011b: {
        Row: {
          claim_id: string | null
          claim_type: string | null
          created_at: string | null
          entity_id: string | null
          evidence: Json | null
          status: string | null
          user_id: string | null
          verified_at: string | null
        }
        Insert: {
          claim_id?: string | null
          claim_type?: string | null
          created_at?: string | null
          entity_id?: string | null
          evidence?: Json | null
          status?: string | null
          user_id?: string | null
          verified_at?: string | null
        }
        Update: {
          claim_id?: string | null
          claim_type?: string | null
          created_at?: string | null
          entity_id?: string | null
          evidence?: Json | null
          status?: string | null
          user_id?: string | null
          verified_at?: string | null
        }
        Relationships: []
      }
      zz_backup_exp_claim_events_20261011b: {
        Row: {
          contact_email: string | null
          contact_phone: string | null
          contact_updated_at: string | null
          contact_updated_by: string | null
          demo_batch: string | null
          entity_id: string | null
          entity_label: string | null
          entity_type: string | null
          event_type: string | null
          group_key: string | null
          id: string | null
          is_demo: boolean | null
          logo_org_id: string | null
          nora_engagement: number | null
          occurred_at: string | null
          seller_id: string | null
          state: string | null
          territory_id: string | null
          upgraded: boolean | null
        }
        Insert: {
          contact_email?: string | null
          contact_phone?: string | null
          contact_updated_at?: string | null
          contact_updated_by?: string | null
          demo_batch?: string | null
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string | null
          event_type?: string | null
          group_key?: string | null
          id?: string | null
          is_demo?: boolean | null
          logo_org_id?: string | null
          nora_engagement?: number | null
          occurred_at?: string | null
          seller_id?: string | null
          state?: string | null
          territory_id?: string | null
          upgraded?: boolean | null
        }
        Update: {
          contact_email?: string | null
          contact_phone?: string | null
          contact_updated_at?: string | null
          contact_updated_by?: string | null
          demo_batch?: string | null
          entity_id?: string | null
          entity_label?: string | null
          entity_type?: string | null
          event_type?: string | null
          group_key?: string | null
          id?: string | null
          is_demo?: boolean | null
          logo_org_id?: string | null
          nora_engagement?: number | null
          occurred_at?: string | null
          seller_id?: string | null
          state?: string | null
          territory_id?: string | null
          upgraded?: boolean | null
        }
        Relationships: []
      }
      zz_backup_exp_control_grants_20261011b: {
        Row: {
          created_at: string | null
          id: string | null
          is_primary: boolean | null
          role: string | null
          scope_id: string | null
          scope_type: string | null
          user_id: string | null
        }
        Insert: {
          created_at?: string | null
          id?: string | null
          is_primary?: boolean | null
          role?: string | null
          scope_id?: string | null
          scope_type?: string | null
          user_id?: string | null
        }
        Update: {
          created_at?: string | null
          id?: string | null
          is_primary?: boolean | null
          role?: string | null
          scope_id?: string | null
          scope_type?: string | null
          user_id?: string | null
        }
        Relationships: []
      }
      zz_backup_exp_entity_keys_20261011b: {
        Row: {
          claim_state: string | null
          entity_id: string | null
          identity_keys: Json | null
          updated_at: string | null
        }
        Insert: {
          claim_state?: string | null
          entity_id?: string | null
          identity_keys?: Json | null
          updated_at?: string | null
        }
        Update: {
          claim_state?: string | null
          entity_id?: string | null
          identity_keys?: Json | null
          updated_at?: string | null
        }
        Relationships: []
      }
      zz_backup_exp_listings_field_map_20261011b: {
        Row: {
          applicability: string | null
          id: number | null
          our_target: string | null
          publisher_id: string | null
          rules: string | null
          section: string | null
          section_note: string | null
          sort: number | null
          status_default: string | null
          their_field: string | null
          variant_family: string | null
        }
        Insert: {
          applicability?: string | null
          id?: number | null
          our_target?: string | null
          publisher_id?: string | null
          rules?: string | null
          section?: string | null
          section_note?: string | null
          sort?: number | null
          status_default?: string | null
          their_field?: string | null
          variant_family?: string | null
        }
        Update: {
          applicability?: string | null
          id?: number | null
          our_target?: string | null
          publisher_id?: string | null
          rules?: string | null
          section?: string | null
          section_note?: string | null
          sort?: number | null
          status_default?: string | null
          their_field?: string | null
          variant_family?: string | null
        }
        Relationships: []
      }
      zz_backup_exp_listings_publishers_20261011b: {
        Row: {
          api_notes: string | null
          id: string | null
          kind: string | null
          name: string | null
          ops_notes: Json | null
          publishes_to: string | null
        }
        Insert: {
          api_notes?: string | null
          id?: string | null
          kind?: string | null
          name?: string | null
          ops_notes?: Json | null
          publishes_to?: string | null
        }
        Update: {
          api_notes?: string | null
          id?: string | null
          kind?: string | null
          name?: string | null
          ops_notes?: Json | null
          publishes_to?: string | null
        }
        Relationships: []
      }
      zz_backup_exp_skill_registry_20261011b: {
        Row: {
          affects_lanes: string[] | null
          autonomy: string | null
          captures_consent: boolean | null
          charges_money: boolean | null
          created_at: string | null
          decline_mute_days: number | null
          entity_types: string[] | null
          estimated_duration: string | null
          expected_srs_lift: number | null
          explanation_template: string | null
          gap_closed: string | null
          graph_writes: string[] | null
          guardrails: string[] | null
          id: string | null
          is_active: boolean | null
          is_async: boolean | null
          key: string | null
          model_tier: string | null
          offer_expected_points: number | null
          offer_ranking_effect: string | null
          owning_surface: string | null
          permanently_dismissible: boolean | null
          price_ref: string | null
          produces_report: boolean | null
          reads_state: string[] | null
          report_to_weekly_digest: boolean | null
          requires_entitlement: string | null
          requires_user_approval: boolean | null
          result_metrics: string[] | null
          status: string | null
          success_event: string | null
          summary: string | null
          title: string | null
          tools_used: string[] | null
          tracks_results: boolean | null
          trial_eligible: boolean | null
          triggers: string[] | null
          updated_at: string | null
          value_loop: string | null
          value_prop: string | null
          version: string | null
        }
        Insert: {
          affects_lanes?: string[] | null
          autonomy?: string | null
          captures_consent?: boolean | null
          charges_money?: boolean | null
          created_at?: string | null
          decline_mute_days?: number | null
          entity_types?: string[] | null
          estimated_duration?: string | null
          expected_srs_lift?: number | null
          explanation_template?: string | null
          gap_closed?: string | null
          graph_writes?: string[] | null
          guardrails?: string[] | null
          id?: string | null
          is_active?: boolean | null
          is_async?: boolean | null
          key?: string | null
          model_tier?: string | null
          offer_expected_points?: number | null
          offer_ranking_effect?: string | null
          owning_surface?: string | null
          permanently_dismissible?: boolean | null
          price_ref?: string | null
          produces_report?: boolean | null
          reads_state?: string[] | null
          report_to_weekly_digest?: boolean | null
          requires_entitlement?: string | null
          requires_user_approval?: boolean | null
          result_metrics?: string[] | null
          status?: string | null
          success_event?: string | null
          summary?: string | null
          title?: string | null
          tools_used?: string[] | null
          tracks_results?: boolean | null
          trial_eligible?: boolean | null
          triggers?: string[] | null
          updated_at?: string | null
          value_loop?: string | null
          value_prop?: string | null
          version?: string | null
        }
        Update: {
          affects_lanes?: string[] | null
          autonomy?: string | null
          captures_consent?: boolean | null
          charges_money?: boolean | null
          created_at?: string | null
          decline_mute_days?: number | null
          entity_types?: string[] | null
          estimated_duration?: string | null
          expected_srs_lift?: number | null
          explanation_template?: string | null
          gap_closed?: string | null
          graph_writes?: string[] | null
          guardrails?: string[] | null
          id?: string | null
          is_active?: boolean | null
          is_async?: boolean | null
          key?: string | null
          model_tier?: string | null
          offer_expected_points?: number | null
          offer_ranking_effect?: string | null
          owning_surface?: string | null
          permanently_dismissible?: boolean | null
          price_ref?: string | null
          produces_report?: boolean | null
          reads_state?: string[] | null
          report_to_weekly_digest?: boolean | null
          requires_entitlement?: string | null
          requires_user_approval?: boolean | null
          result_metrics?: string[] | null
          status?: string | null
          success_event?: string | null
          summary?: string | null
          title?: string | null
          tools_used?: string[] | null
          tracks_results?: boolean | null
          trial_eligible?: boolean | null
          triggers?: string[] | null
          updated_at?: string | null
          value_loop?: string | null
          value_prop?: string | null
          version?: string | null
        }
        Relationships: []
      }
      zz_backup_exp_verification_requests_20261011b: {
        Row: {
          channel: string | null
          claim_event_id: string | null
          created_at: string | null
          destination: string | null
          entity_id: string | null
          entity_type: string | null
          id: string | null
          requested_by: string | null
          status: string | null
        }
        Insert: {
          channel?: string | null
          claim_event_id?: string | null
          created_at?: string | null
          destination?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          requested_by?: string | null
          status?: string | null
        }
        Update: {
          channel?: string | null
          claim_event_id?: string | null
          created_at?: string | null
          destination?: string | null
          entity_id?: string | null
          entity_type?: string | null
          id?: string | null
          requested_by?: string | null
          status?: string | null
        }
        Relationships: []
      }
      zz_backup_functions_20261011b: {
        Row: {
          def: string | null
          name: string | null
          saved_at: string | null
        }
        Insert: {
          def?: string | null
          name?: string | null
          saved_at?: string | null
        }
        Update: {
          def?: string | null
          name?: string | null
          saved_at?: string | null
        }
        Relationships: []
      }
      zz_backup_graph_nodes_20260912: {
        Row: {
          id: string | null
          node_registry_id: string | null
          node_type: string | null
          ring: number | null
        }
        Insert: {
          id?: string | null
          node_registry_id?: string | null
          node_type?: string | null
          ring?: number | null
        }
        Update: {
          id?: string | null
          node_registry_id?: string | null
          node_type?: string | null
          ring?: number | null
        }
        Relationships: []
      }
      zz_backup_re_compliance_20260725: {
        Row: {
          advertising_rules_url: string | null
          age_gate_minimum: number | null
          age_gate_required: boolean | null
          age_gate_type: string | null
          compliance_notes: string | null
          content_restrictions: string[] | null
          coppa_applies: boolean | null
          created_at: string | null
          disclaimer_placement: string[] | null
          display_license_on_ads: boolean | null
          display_license_on_content: boolean | null
          display_license_on_email: boolean | null
          display_license_on_profile: boolean | null
          ferpa_applies: boolean | null
          gcid: string | null
          glba_applies: boolean | null
          hipaa_applies: boolean | null
          license_display_format: string | null
          license_label: string | null
          prohibited_phrases: string[] | null
          regulated_by: string[] | null
          required_disclaimers: string[] | null
          required_disclosures: string[] | null
          review_transaction_required: boolean | null
          review_verification_required: boolean | null
          updated_at: string | null
        }
        Insert: {
          advertising_rules_url?: string | null
          age_gate_minimum?: number | null
          age_gate_required?: boolean | null
          age_gate_type?: string | null
          compliance_notes?: string | null
          content_restrictions?: string[] | null
          coppa_applies?: boolean | null
          created_at?: string | null
          disclaimer_placement?: string[] | null
          display_license_on_ads?: boolean | null
          display_license_on_content?: boolean | null
          display_license_on_email?: boolean | null
          display_license_on_profile?: boolean | null
          ferpa_applies?: boolean | null
          gcid?: string | null
          glba_applies?: boolean | null
          hipaa_applies?: boolean | null
          license_display_format?: string | null
          license_label?: string | null
          prohibited_phrases?: string[] | null
          regulated_by?: string[] | null
          required_disclaimers?: string[] | null
          required_disclosures?: string[] | null
          review_transaction_required?: boolean | null
          review_verification_required?: boolean | null
          updated_at?: string | null
        }
        Update: {
          advertising_rules_url?: string | null
          age_gate_minimum?: number | null
          age_gate_required?: boolean | null
          age_gate_type?: string | null
          compliance_notes?: string | null
          content_restrictions?: string[] | null
          coppa_applies?: boolean | null
          created_at?: string | null
          disclaimer_placement?: string[] | null
          display_license_on_ads?: boolean | null
          display_license_on_content?: boolean | null
          display_license_on_email?: boolean | null
          display_license_on_profile?: boolean | null
          ferpa_applies?: boolean | null
          gcid?: string | null
          glba_applies?: boolean | null
          hipaa_applies?: boolean | null
          license_display_format?: string | null
          license_label?: string | null
          prohibited_phrases?: string[] | null
          regulated_by?: string[] | null
          required_disclaimers?: string[] | null
          required_disclosures?: string[] | null
          review_transaction_required?: boolean | null
          review_verification_required?: boolean | null
          updated_at?: string | null
        }
        Relationships: []
      }
      zz_backup_re_knowledge_20260725: {
        Row: {
          ai_agents: Json | null
          compliance_rules: string[] | null
          content_topics: string[] | null
          conversion_actions: Json | null
          created_at: string | null
          customer_journey: Json | null
          entity_type: string | null
          exclusion_reason: string | null
          expertise_signals: Json | null
          gcid: string | null
          id: string | null
          is_launched: boolean | null
          knowledge_pct: number | null
          pricing_tier: string | null
          ranking_factors: Json | null
          review_vocabulary: string[] | null
          scoring_weights: Json | null
          search_intents: Json | null
          services: Json | null
          status: string | null
          terminology: string[] | null
          updated_at: string | null
          value_props: Json | null
        }
        Insert: {
          ai_agents?: Json | null
          compliance_rules?: string[] | null
          content_topics?: string[] | null
          conversion_actions?: Json | null
          created_at?: string | null
          customer_journey?: Json | null
          entity_type?: string | null
          exclusion_reason?: string | null
          expertise_signals?: Json | null
          gcid?: string | null
          id?: string | null
          is_launched?: boolean | null
          knowledge_pct?: number | null
          pricing_tier?: string | null
          ranking_factors?: Json | null
          review_vocabulary?: string[] | null
          scoring_weights?: Json | null
          search_intents?: Json | null
          services?: Json | null
          status?: string | null
          terminology?: string[] | null
          updated_at?: string | null
          value_props?: Json | null
        }
        Update: {
          ai_agents?: Json | null
          compliance_rules?: string[] | null
          content_topics?: string[] | null
          conversion_actions?: Json | null
          created_at?: string | null
          customer_journey?: Json | null
          entity_type?: string | null
          exclusion_reason?: string | null
          expertise_signals?: Json | null
          gcid?: string | null
          id?: string | null
          is_launched?: boolean | null
          knowledge_pct?: number | null
          pricing_tier?: string | null
          ranking_factors?: Json | null
          review_vocabulary?: string[] | null
          scoring_weights?: Json | null
          search_intents?: Json | null
          services?: Json | null
          status?: string | null
          terminology?: string[] | null
          updated_at?: string | null
          value_props?: Json | null
        }
        Relationships: []
      }
      zz_backup_re_registry_20260725: {
        Row: {
          compliance_notes: string | null
          connection_method: string | null
          created_at: string | null
          entity_scope: string | null
          gcid: string | null
          id: string | null
          is_active: boolean | null
          node_description: string | null
          node_name: string | null
          node_slug: string | null
          notes: string | null
          priority: number | null
          required_for_score: boolean | null
          ring: string | null
          schema_property: string | null
          schema_type: string | null
          score_points: number | null
          updated_at: string | null
          url_example: string | null
          url_pattern: string | null
        }
        Insert: {
          compliance_notes?: string | null
          connection_method?: string | null
          created_at?: string | null
          entity_scope?: string | null
          gcid?: string | null
          id?: string | null
          is_active?: boolean | null
          node_description?: string | null
          node_name?: string | null
          node_slug?: string | null
          notes?: string | null
          priority?: number | null
          required_for_score?: boolean | null
          ring?: string | null
          schema_property?: string | null
          schema_type?: string | null
          score_points?: number | null
          updated_at?: string | null
          url_example?: string | null
          url_pattern?: string | null
        }
        Update: {
          compliance_notes?: string | null
          connection_method?: string | null
          created_at?: string | null
          entity_scope?: string | null
          gcid?: string | null
          id?: string | null
          is_active?: boolean | null
          node_description?: string | null
          node_name?: string | null
          node_slug?: string | null
          notes?: string | null
          priority?: number | null
          required_for_score?: boolean | null
          ring?: string | null
          schema_property?: string | null
          schema_type?: string | null
          score_points?: number | null
          updated_at?: string | null
          url_example?: string | null
          url_pattern?: string | null
        }
        Relationships: []
      }
      zz_backup_re_taxonomy_20260725: {
        Row: {
          created_at: string | null
          description: string | null
          gcid: string | null
          id: string | null
          is_active: boolean | null
          is_required: boolean | null
          level: string | null
          parent_id: string | null
          priority: number | null
          schema_property: string | null
          schema_type: string | null
          score_weight: number | null
          search_intent: string | null
          search_volume_monthly: number | null
          source: string | null
          term: string | null
          term_display: string | null
          term_slug: string | null
          updated_at: string | null
          use_agents: boolean | null
          use_schema: boolean | null
          use_search: boolean | null
          use_srp: boolean | null
          use_voce: boolean | null
          validated: boolean | null
          wikidata_id: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          gcid?: string | null
          id?: string | null
          is_active?: boolean | null
          is_required?: boolean | null
          level?: string | null
          parent_id?: string | null
          priority?: number | null
          schema_property?: string | null
          schema_type?: string | null
          score_weight?: number | null
          search_intent?: string | null
          search_volume_monthly?: number | null
          source?: string | null
          term?: string | null
          term_display?: string | null
          term_slug?: string | null
          updated_at?: string | null
          use_agents?: boolean | null
          use_schema?: boolean | null
          use_search?: boolean | null
          use_srp?: boolean | null
          use_voce?: boolean | null
          validated?: boolean | null
          wikidata_id?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          gcid?: string | null
          id?: string | null
          is_active?: boolean | null
          is_required?: boolean | null
          level?: string | null
          parent_id?: string | null
          priority?: number | null
          schema_property?: string | null
          schema_type?: string | null
          score_weight?: number | null
          search_intent?: string | null
          search_volume_monthly?: number | null
          source?: string | null
          term?: string | null
          term_display?: string | null
          term_slug?: string | null
          updated_at?: string | null
          use_agents?: boolean | null
          use_schema?: boolean | null
          use_search?: boolean | null
          use_srp?: boolean | null
          use_voce?: boolean | null
          validated?: boolean | null
          wikidata_id?: string | null
        }
        Relationships: []
      }
      zz_backup_search_documents_20261011: {
        Row: {
          city: string | null
          claimed: boolean | null
          completeness_pct: number | null
          entity_id: string | null
          entity_type: string | null
          fts: unknown
          gcid: string | null
          id: string | null
          is_demo: boolean | null
          languages: string[] | null
          lat: number | null
          lng: number | null
          name: string | null
          photo_url: string | null
          rank_score: number | null
          rating: number | null
          review_count: number | null
          score_basis: string | null
          slug: string | null
          state: string | null
          title: string | null
          updated_at: string | null
          zip: string | null
        }
        Insert: {
          city?: string | null
          claimed?: boolean | null
          completeness_pct?: number | null
          entity_id?: string | null
          entity_type?: string | null
          fts?: unknown
          gcid?: string | null
          id?: string | null
          is_demo?: boolean | null
          languages?: string[] | null
          lat?: number | null
          lng?: number | null
          name?: string | null
          photo_url?: string | null
          rank_score?: number | null
          rating?: number | null
          review_count?: number | null
          score_basis?: string | null
          slug?: string | null
          state?: string | null
          title?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Update: {
          city?: string | null
          claimed?: boolean | null
          completeness_pct?: number | null
          entity_id?: string | null
          entity_type?: string | null
          fts?: unknown
          gcid?: string | null
          id?: string | null
          is_demo?: boolean | null
          languages?: string[] | null
          lat?: number | null
          lng?: number | null
          name?: string | null
          photo_url?: string | null
          rank_score?: number | null
          rating?: number | null
          review_count?: number | null
          score_basis?: string | null
          slug?: string | null
          state?: string | null
          title?: string | null
          updated_at?: string | null
          zip?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      exp_category_intelligence: {
        Row: {
          ai_agents: Json | null
          compliance_rules: string[] | null
          content_topics: string[] | null
          conversion_actions: Json | null
          customer_journey: Json | null
          display_license_on_profile: boolean | null
          display_name: string | null
          entity_type: string | null
          expertise_signals: Json | null
          gcid: string | null
          has_compliance: boolean | null
          has_schema_projection: boolean | null
          is_launched: boolean | null
          knowledge_pct: number | null
          mapped_properties: number | null
          pricing_tier: string | null
          ranking_factors: Json | null
          registry_nodes: number | null
          regulated_by: string[] | null
          review_vocabulary: string[] | null
          rings_with_properties: number | null
          schema_type: string | null
          schema_type_confidence: string | null
          scoring_weights: Json | null
          search_intents: Json | null
          services: Json | null
          status: string | null
          taxonomy_levels_covered: number | null
          taxonomy_terms: number | null
          terminology: string[] | null
          value_props: Json | null
        }
        Relationships: []
      }
      exp_etl_coverage: {
        Row: {
          agents_in_graph: number | null
          agents_license_matched: number | null
          gcid: string | null
        }
        Relationships: []
      }
      exp_search_facets_v: {
        Row: {
          attribute_id: string | null
          facet_group: string | null
          facet_label: string | null
          gcid: string | null
          repeatable: boolean | null
          value_options: Json | null
          value_type: string | null
        }
        Insert: {
          attribute_id?: string | null
          facet_group?: string | null
          facet_label?: string | null
          gcid?: string | null
          repeatable?: boolean | null
          value_options?: Json | null
          value_type?: string | null
        }
        Update: {
          attribute_id?: string | null
          facet_group?: string | null
          facet_label?: string | null
          gcid?: string | null
          repeatable?: boolean | null
          value_options?: Json | null
          value_type?: string | null
        }
        Relationships: []
      }
      v_categories_pending_knowledge: {
        Row: {
          display_name: string | null
          entity_type: string | null
          gcid: string | null
          is_launched: boolean | null
          knowledge_pct: number | null
          status: string | null
        }
        Relationships: []
      }
      v_categories_unmapped: {
        Row: {
          display_name: string | null
          gcid: string | null
        }
        Relationships: []
      }
      v_category_node_registry: {
        Row: {
          category_name: string | null
          compliance_notes: string | null
          connection_method: string | null
          gcid: string | null
          node_name: string | null
          priority: number | null
          required_for_score: boolean | null
          ring: string | null
          schema_type: string | null
          score_points: number | null
          url_pattern: string | null
        }
        Relationships: []
      }
      v_category_score_potential: {
        Row: {
          gcid: string | null
          node_count: number | null
          required_points: number | null
          ring: string | null
          total_points_available: number | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_vertical_node_registry_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_vertical_node_registry_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_vertical_node_registry_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_vertical_node_registry_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_vertical_node_registry_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_vertical_node_registry_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      v_claim_queue_pending: {
        Row: {
          claimant_email: string | null
          claimant_name: string | null
          confidence_score: number | null
          created_at: string | null
          entity_id: string | null
          entity_type: string | null
          gcid: string | null
          id: string | null
          match_method: string | null
          profile_name: string | null
          status: string | null
        }
        Relationships: [
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      v_compliance_status: {
        Row: {
          age_gate_required: boolean | null
          compliance_gcid: string | null
          compliance_score: number | null
          disclaimers_shown: boolean | null
          display_license_on_profile: boolean | null
          display_name: string | null
          gcid: string | null
          hipaa_applies: boolean | null
          id: string | null
          license_displayed: boolean | null
          missing_items: string[] | null
          slug: string | null
          terms_accepted: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "exp_category_compliance_gcid_fkey"
            columns: ["compliance_gcid"]
            isOneToOne: true
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_compliance_gcid_fkey"
            columns: ["compliance_gcid"]
            isOneToOne: true
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_compliance_gcid_fkey"
            columns: ["compliance_gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_compliance_gcid_fkey"
            columns: ["compliance_gcid"]
            isOneToOne: true
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_compliance_gcid_fkey"
            columns: ["compliance_gcid"]
            isOneToOne: true
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "exp_category_compliance_gcid_fkey"
            columns: ["compliance_gcid"]
            isOneToOne: true
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      v_launched_categories: {
        Row: {
          display_name: string | null
          entity_type: string | null
          gcid: string | null
          is_launched: boolean | null
          knowledge_pct: number | null
          more_hours_count: number | null
          pricing_tier: string | null
          service_type_count: number | null
          slug: string | null
          status: string | null
        }
        Relationships: []
      }
      v_logo_expansion: {
        Row: {
          baseline: number | null
          expansion_pct: number | null
          expansion_revenue: number | null
          first_booking_at: string | null
          group_key: string | null
          new_revenue: number | null
          org_id: string | null
          org_name: string | null
          year: number | null
          ytd_revenue: number | null
        }
        Relationships: []
      }
      v_logo_expansion_month: {
        Row: {
          cumulative_revenue: number | null
          group_key: string | null
          month_revenue: number | null
          month_start: string | null
          org_id: string | null
          org_name: string | null
          year: number | null
        }
        Relationships: []
      }
      v_logo_revenue: {
        Row: {
          amount: number | null
          created_at: string | null
          group_key: string | null
          month_start: string | null
          org_id: string | null
          org_name: string | null
          period_start: string | null
          revenue_id: string | null
          source: string | null
          year: number | null
        }
        Relationships: []
      }
      v_logo_revenue_month: {
        Row: {
          amount: number | null
          group_key: string | null
          month_start: string | null
          org_id: string | null
          org_name: string | null
          year: number | null
        }
        Relationships: []
      }
      v_market_leaderboard: {
        Row: {
          address_city: string | null
          address_state: string | null
          display_name: string | null
          gcid: string | null
          job_title: string | null
          local_rank: number | null
          photo_url: string | null
          rating_value: number | null
          review_count: number | null
          slug: string | null
          top_pct: number | null
          total_score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      v_plg_next_actions: {
        Row: {
          display_name: string | null
          gaps: Json | null
          gcid: string | null
          id: string | null
          next_milestone: number | null
          next_milestone_gap: number | null
          slug: string | null
          total_score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      v_professional_profile: {
        Row: {
          address_city: string | null
          address_state: string | null
          age_gate_required: boolean | null
          avg_rating: number | null
          bio: string | null
          category_name: string | null
          claimed: boolean | null
          compliance_complete: boolean | null
          compliance_score: number | null
          display_license_on_profile: boolean | null
          display_name: string | null
          gaps: Json | null
          gcid: string | null
          headline: string | null
          id: string | null
          job_title: string | null
          license_display_format: string | null
          local_rank: number | null
          local_rank_of: number | null
          markets_served: string[] | null
          org_name: string | null
          org_slug: string | null
          photo_url: string | null
          primary_license_number: string | null
          primary_license_type: string | null
          primary_license_verified: boolean | null
          required_disclaimers: string[] | null
          review_count: number | null
          same_as: string[] | null
          score_change_7d: number | null
          score_pct: number | null
          slug: string | null
          subscription_plan: string | null
          top_pct: number | null
          total_score: number | null
        }
        Relationships: [
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "exp_category_intelligence"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "gbp_categories"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_pending_knowledge"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_categories_unmapped"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_category_node_registry"
            referencedColumns: ["gcid"]
          },
          {
            foreignKeyName: "professionals_gcid_fkey"
            columns: ["gcid"]
            isOneToOne: false
            referencedRelation: "v_launched_categories"
            referencedColumns: ["gcid"]
          },
        ]
      }
      v_schema_regeneration_queue: {
        Row: {
          entity_id: string | null
          entity_type: string | null
          invalidated_at: string | null
          page_type: string | null
        }
        Insert: {
          entity_id?: string | null
          entity_type?: string | null
          invalidated_at?: string | null
          page_type?: string | null
        }
        Update: {
          entity_id?: string | null
          entity_type?: string | null
          invalidated_at?: string | null
          page_type?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      _exp_claim_adjudicate_core: {
        Args: {
          p_approve: boolean
          p_claim: string
          p_note: string
          p_reviewer: string
        }
        Returns: Json
      }
      _exp_claim_event: {
        Args: { p_claim: string; p_event: string }
        Returns: string
      }
      _exp_claim_grant_core: {
        Args: {
          p_acting_role: string
          p_claim: string
          p_queue_status: string
          p_reviewer: string
        }
        Returns: Json
      }
      _exp_entity_for_record: {
        Args: { p_create?: boolean; p_record_id: string; p_record_type: string }
        Returns: string
      }
      _exp_entity_link_record: {
        Args: { p_entity: string; p_record_id: string; p_record_type: string }
        Returns: undefined
      }
      _exp_entity_record: {
        Args: { p_entity: string }
        Returns: Record<string, unknown>
      }
      bootstrap_control_super_admin: { Args: never; Returns: string }
      disco_activate: { Args: { p_category: string }; Returns: number }
      disco_check_method_complete: {
        Args: { p_cat: string }
        Returns: undefined
      }
      disco_confirm_companies: {
        Args: { p_approved_domains: string[]; p_proposal_id: number }
        Returns: Json
      }
      disco_discover_ingest: {
        Args: { p_companies: Json; p_request_id: number }
        Returns: number
      }
      disco_dispatch: { Args: never; Returns: undefined }
      disco_map_site_ingest: {
        Args: { p_contract: Json; p_request_id: number }
        Returns: undefined
      }
      disco_map_site_no_profiles: {
        Args: { p_evidence: Json; p_request_id: number }
        Returns: undefined
      }
      disco_method_ingest:
        | {
            Args: {
              p_domain: string
              p_evidence: string
              p_method: string
              p_request_id: number
            }
            Returns: undefined
          }
        | {
            Args: {
              p_domain: string
              p_evidence: string
              p_fetch_tier?: string
              p_method: string
              p_request_id: number
            }
            Returns: undefined
          }
      disco_request_remap_site: {
        Args: { p_source_id: string }
        Returns: number
      }
      disco_retry_method_classification: {
        Args: { p_source_id: string }
        Returns: undefined
      }
      exp__category_proposal_actor: {
        Args: { p_actor: string }
        Returns: string
      }
      exp__category_proposal_apply_one: {
        Args: {
          p: Database["public"]["Tables"]["exp_category_proposals"]["Row"]
        }
        Returns: undefined
      }
      exp_alert_accept: { Args: { p_alert: string }; Returns: string }
      exp_alerts_absence_rules: { Args: { p_now?: string }; Returns: number }
      exp_alerts_event_rules: {
        Args: { p_now?: string; p_org: string }
        Returns: number
      }
      exp_alerts_generate: { Args: { p_now?: string }; Returns: number }
      exp_audit_collect: { Args: never; Returns: undefined }
      exp_audit_tick: { Args: never; Returns: undefined }
      exp_audit_tick2: { Args: never; Returns: undefined }
      exp_brand_domain: { Args: { p_id: string }; Returns: string }
      exp_build_field_model_v3: { Args: { p_gcid: string }; Returns: Json }
      exp_build_prompt_bundle: { Args: { p_gcid: string }; Returns: Json }
      exp_category_proposal_apply: {
        Args: { p_batch: string; p_max_gcids?: number }
        Returns: {
          out_applied: number
          out_detail: string
          out_gcid: string
          out_state: string
        }[]
      }
      exp_category_proposal_review: {
        Args: {
          p_approve?: boolean
          p_batch: string
          p_ids?: number[]
          p_note?: string
          p_reviewer?: string
        }
        Returns: number
      }
      exp_claim_adjudicate: {
        Args: { p_approve: boolean; p_claim: string; p_note?: string }
        Returns: undefined
      }
      exp_claim_gate_advance: {
        Args: {
          p_actor: string
          p_claim: string
          p_evidence?: Json
          p_path?: string
          p_queue_status?: string
          p_tier: number
        }
        Returns: Json
      }
      exp_claim_gate_challenge: {
        Args: {
          p_actor: string
          p_body_html: string
          p_claim: string
          p_code_hash: string
          p_subject: string
          p_ttl_minutes?: number
        }
        Returns: Json
      }
      exp_claim_gate_grant: {
        Args: { p_actor: string; p_claim: string }
        Returns: Json
      }
      exp_claim_gate_is_service: { Args: never; Returns: boolean }
      exp_claim_gate_release: {
        Args: { p_actor?: string; p_claim: string; p_reason?: string }
        Returns: Json
      }
      exp_claim_gate_start: {
        Args: {
          p_actor: string
          p_claimant_email?: string
          p_claimant_name?: string
          p_confidence?: number
          p_method?: string
          p_path?: string
          p_record_id: string
          p_record_type: string
          p_signals?: Json
          p_tier?: number
        }
        Returns: Json
      }
      exp_claim_gate_verify_otp: {
        Args: { p_actor: string; p_claim: string; p_code_hash: string }
        Returns: Json
      }
      exp_claim_queue_adjudicate: {
        Args: { p_approve: boolean; p_note?: string; p_queue: string }
        Returns: Json
      }
      exp_claim_queue_verification: {
        Args: { p_events: string[] }
        Returns: number
      }
      exp_claim_request: {
        Args: { p_entity: string; p_evidence?: Json }
        Returns: string
      }
      exp_claim_set_contact: {
        Args: {
          p_claimed_override?: boolean
          p_email: string
          p_event: string
          p_phone: string
        }
        Returns: Json
      }
      exp_claim_tier: {
        Args: { p_entity: string; p_user?: string }
        Returns: number
      }
      exp_compute_score: {
        Args: { p_entity_id: string }
        Returns: {
          calculated_at: string | null
          entity_id: string
          entity_type: string
          gaps: Json | null
          gcid: string | null
          id: string
          local_market: string | null
          local_rank: number | null
          local_rank_of: number | null
          max_possible: number
          next_milestone: number | null
          next_milestone_gap: number | null
          previous_score: number | null
          score_change_30d: number | null
          score_change_7d: number | null
          score_connections: number | null
          score_content: number | null
          score_listings: number | null
          score_pct: number | null
          score_profile: number | null
          score_reviews: number | null
          score_web_analytics: number | null
          top_pct: number | null
          total_score: number
        }
        SetofOptions: {
          from: "*"
          to: "search_rank_scores"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      exp_compute_score_v2: {
        Args: { p_entity_id: string; p_gcid: string; p_scope: string }
        Returns: Json
      }
      exp_contract_provision: { Args: { p_contract: string }; Returns: number }
      exp_crm_actor: {
        Args: { p_opp: string }
        Returns: {
          rep_id: string
          role: string
          user_id: string
        }[]
      }
      exp_crm_demo_seed: { Args: { p_batch: string }; Returns: Json }
      exp_crm_demo_teardown: { Args: { p_batch: string }; Returns: Json }
      exp_ctrl_create_node: {
        Args: {
          p_billing?: boolean
          p_linked_entity?: string
          p_name: string
          p_node_type: string
          p_parent?: string
        }
        Returns: string
      }
      exp_ctrl_has_role: { Args: { p_roles: string[] }; Returns: boolean }
      exp_ctrl_update_node: {
        Args: {
          p_billing?: boolean
          p_id: string
          p_linked_entity?: string
          p_move?: boolean
          p_name?: string
          p_node_type?: string
          p_parent?: string
          p_status?: string
        }
        Returns: undefined
      }
      exp_demo_build: { Args: { p_gcid: string }; Returns: Json }
      exp_demo_teardown: {
        Args: { p_batch: string; p_dryrun?: boolean }
        Returns: {
          rows: number
          step: number
          tbl: string
        }[]
      }
      exp_disco_ai_worker_tick: { Args: never; Returns: undefined }
      exp_disco_worker_config: {
        Args: never
        Returns: {
          base_url: string
          worker_key: string
        }[]
      }
      exp_engine_apply: { Args: { p: Json; p_gcid: string }; Returns: string }
      exp_engine_bloat_pass: { Args: { p_gcid?: string }; Returns: number }
      exp_engine_build_prompt: { Args: { p_gcid: string }; Returns: string }
      exp_engine_collect: { Args: never; Returns: undefined }
      exp_engine_core_fallback: { Args: { p_gcid: string }; Returns: undefined }
      exp_engine_finalize: { Args: { p_gcid: string }; Returns: undefined }
      exp_engine_knowledge_scaffold: {
        Args: { p_gcid: string }
        Returns: undefined
      }
      exp_engine_longtail_pass: { Args: { p_gcid?: string }; Returns: number }
      exp_engine_post_apply_normalize: {
        Args: { p_gcid: string }
        Returns: undefined
      }
      exp_engine_rules_pass: { Args: { p_gcid: string }; Returns: string }
      exp_engine_secondaries_norm: {
        Args: { p_gcid?: string }
        Returns: number
      }
      exp_engine_seed_secondaries: {
        Args: { p_gcid: string; p_stype: string }
        Returns: undefined
      }
      exp_engine_snapshot: { Args: { p_gcid: string }; Returns: undefined }
      exp_engine_stale_ref_repair: {
        Args: { p_gcid?: string }
        Returns: number
      }
      exp_engine_structural_fallback: {
        Args: { p_gcid: string }
        Returns: undefined
      }
      exp_engine_tick: { Args: never; Returns: undefined }
      exp_entity_for_record: {
        Args: { p_create?: boolean; p_record_id: string; p_record_type: string }
        Returns: string
      }
      exp_entity_link_record: {
        Args: { p_entity: string; p_record_id: string; p_record_type: string }
        Returns: undefined
      }
      exp_entity_profile_domain: { Args: { p_id: string }; Returns: string }
      exp_etl_activate_category: { Args: { p_gcid: string }; Returns: string }
      exp_etl_add_source: {
        Args: {
          p_domain: string
          p_gcid: string
          p_notes?: string
          p_type: string
        }
        Returns: string
      }
      exp_etl_approve_companies: {
        Args: { p_gcid: string; p_source_ids: string[] }
        Returns: number
      }
      exp_etl_brand_key: { Args: { p_name: string }; Returns: string }
      exp_etl_check_saturation: {
        Args: { p_gcid: string; p_source: string }
        Returns: number
      }
      exp_etl_cron_list: {
        Args: never
        Returns: {
          active: boolean
          failed_24h: number
          jobid: number
          jobname: string
          last_end: string
          last_message: string
          last_start: string
          last_status: string
          runs_24h: number
          schedule: string
        }[]
      }
      exp_etl_cron_set_active: {
        Args: { p_active: boolean; p_jobname: string }
        Returns: boolean
      }
      exp_etl_enhance: { Args: { p_batch?: number }; Returns: Json }
      exp_etl_entity_nodes: {
        Args: {
          p_attrs: Json
          p_kind: string
          p_name: string
          p_source_url: string
        }
        Returns: Json
      }
      exp_etl_extract_collect: { Args: never; Returns: undefined }
      exp_etl_extract_jsonld: {
        Args: { p_gcid: string; p_jsonld: Json; p_source: string }
        Returns: string
      }
      exp_etl_extract_tick: { Args: never; Returns: undefined }
      exp_etl_fetch_collect: { Args: never; Returns: undefined }
      exp_etl_fetch_tick: { Args: never; Returns: undefined }
      exp_etl_finish_run: {
        Args: { p_errors?: number; p_run: string }
        Returns: undefined
      }
      exp_etl_frontier_discover: {
        Args: { p_domain: string; p_kind?: string; p_urls: string[] }
        Returns: number
      }
      exp_etl_gate_full_pull: {
        Args: { p_gcid: string; p_source: string }
        Returns: Json
      }
      exp_etl_identity_match: {
        Args: { p_keys: Json; p_own_key: string; p_type: string }
        Returns: Json
      }
      exp_etl_launch_category: { Args: { p_gcid: string }; Returns: Json }
      exp_etl_map_fields: { Args: never; Returns: number }
      exp_etl_map_or_add_product: {
        Args: { p_gcid: string; p_raw: string; p_source: string }
        Returns: string
      }
      exp_etl_match_term: {
        Args: {
          p_gcid: string
          p_raw: string
          p_source: string
          p_type: string
        }
        Returns: Json
      }
      exp_etl_merge_attrs: {
        Args: {
          p_derived?: Json
          p_new: Json
          p_old: Json
          p_rank: number
          p_source: string
        }
        Returns: Json
      }
      exp_etl_merge_entities: {
        Args: { p_drop: string; p_keep: string; p_rationale: string }
        Returns: string
      }
      exp_etl_profile_gate: { Args: { p_batch?: number }; Returns: Json }
      exp_etl_publish_entity: { Args: { p_entity: string }; Returns: Json }
      exp_etl_publish_tick: {
        Args: { p_batch?: number; p_domains?: string[] }
        Returns: Json
      }
      exp_etl_recon_collect: { Args: never; Returns: undefined }
      exp_etl_recon_ingest: {
        Args: { p_robots_result: Json; p_source_id: string }
        Returns: undefined
      }
      exp_etl_recon_retry_sweep: { Args: never; Returns: number }
      exp_etl_reconcile_value: {
        Args: {
          p_gcid: string
          p_raw: string
          p_source: string
          p_type: string
        }
        Returns: string
      }
      exp_etl_record_complete: { Args: { p_entity: string }; Returns: Json }
      exp_etl_reharvest_source: { Args: { p_source: string }; Returns: number }
      exp_etl_resolve: { Args: never; Returns: undefined }
      exp_etl_run_source: { Args: { p_source: string }; Returns: string }
      exp_etl_set_field_floor: {
        Args: {
          p_gcid: string
          p_min_fields?: number
          p_min_licenses?: number
          p_min_products?: number
          p_notes?: string
          p_required_keys: string[]
        }
        Returns: Json
      }
      exp_etl_set_limits: {
        Args: {
          p_daily_quota?: number
          p_min_delay?: number
          p_source: string
          p_window?: string
        }
        Returns: undefined
      }
      exp_etl_set_source_status: {
        Args: { p_note?: string; p_source: string; p_status: string }
        Returns: undefined
      }
      exp_etl_slug: {
        Args: { p_kind: string; p_text: string }
        Returns: string
      }
      exp_etl_stage_ingest: {
        Args: {
          p_detail_url?: string
          p_entity_type: string
          p_field_tier?: string
          p_gcid: string
          p_identity_candidates?: Json
          p_payload: Json
          p_source_id: string
        }
        Returns: undefined
      }
      exp_etl_start_recon: { Args: { p_source: string }; Returns: undefined }
      exp_etl_term_norm: { Args: { p: string }; Returns: string }
      exp_facet_lang_tick: { Args: { p_batch?: number }; Returns: number }
      exp_gbp_capture_collect: { Args: never; Returns: undefined }
      exp_gbp_capture_tick: { Args: never; Returns: undefined }
      exp_generate_group_territories: {
        Args: { p_group_key: string }
        Returns: Json
      }
      exp_generate_schema_projection: {
        Args: { p_gcid: string }
        Returns: Json
      }
      exp_generate_territories: { Args: { p_gcid: string }; Returns: Json }
      exp_google_vault_put: {
        Args: { p_existing: string; p_secret: string }
        Returns: string
      }
      exp_graph_add_rel: {
        Args: {
          p_gcid?: string
          p_geo?: Json
          p_object?: string
          p_primary?: boolean
          p_rationale?: string
          p_source?: string
          p_subject: string
          p_type: string
        }
        Returns: string
      }
      exp_graph_create_entity: {
        Args: {
          p_gcid: string
          p_identity_keys?: Json
          p_name: string
          p_rationale?: string
          p_source?: string
          p_type: string
        }
        Returns: string
      }
      exp_graph_node_is_protected: {
        Args: { p_source: string; p_trust: string }
        Returns: boolean
      }
      exp_graph_upsert_nodes: {
        Args: {
          p_entity_id: string
          p_entity_type: string
          p_nodes: Json
          p_source: string
          p_trust: string
        }
        Returns: Json
      }
      exp_haversine_miles: {
        Args: { a_lat: number; a_lng: number; b_lat: number; b_lng: number }
        Returns: number
      }
      exp_index_canonical_path: {
        Args: { p_lane: string; p_slug: string }
        Returns: string
      }
      exp_index_completeness_floor: {
        Args: { p_gcid: string; p_lane: string }
        Returns: number
      }
      exp_index_enabled: { Args: never; Returns: boolean }
      exp_index_guard: { Args: never; Returns: boolean }
      exp_index_job_install: {
        Args: { p_command: string; p_jobname: string; p_schedule: string }
        Returns: Json
      }
      exp_index_recrawl: { Args: { p_entity_id: string }; Returns: Json }
      exp_index_submit_tick: { Args: { p_batch?: number }; Returns: Json }
      exp_index_sync: { Args: { p_limit?: number }; Returns: Json }
      exp_longtail_seed: { Args: never; Returns: undefined }
      exp_norm_address: { Args: { p: string }; Returns: string }
      exp_norm_brand: { Args: { p: string }; Returns: string }
      exp_normalize_connection_methods: {
        Args: { p_gcid?: string }
        Returns: number
      }
      exp_office_mode: {
        Args: { p_entity_id: string; p_entity_type: string }
        Returns: Json
      }
      exp_open_opps: {
        Args: { p_org: string }
        Returns: {
          account_id: string
          created_at: string
          demo_batch: string
          id: string
          is_demo: boolean
          name: string
          org_id: string
          owner_id: string
          stage: string
        }[]
      }
      exp_opp_advance_stage: {
        Args: { p_captured?: Json; p_opp: string; p_target: string }
        Returns: string
      }
      exp_opp_close_lost: {
        Args: {
          p_competitor?: string
          p_opp: string
          p_reason: string
          p_revisit?: string
        }
        Returns: string
      }
      exp_opp_close_won: {
        Args: { p_captured?: Json; p_opp: string }
        Returns: string
      }
      exp_opp_create: {
        Args: {
          p_account_id: string
          p_org_id: string
          p_owner: string
          p_source: string
        }
        Returns: Json
      }
      exp_probe_collect: { Args: never; Returns: undefined }
      exp_probe_methods: { Args: never; Returns: undefined }
      exp_provisional_score_tick: {
        Args: { p_batch?: number }
        Returns: number
      }
      exp_r1_complete_lanes: { Args: never; Returns: undefined }
      exp_r17_tick: { Args: never; Returns: undefined }
      exp_resolve_offices: { Args: never; Returns: number }
      exp_resolve_rep: { Args: { p_owner: string }; Returns: string }
      exp_ring_finalize: { Args: never; Returns: undefined }
      exp_ring_finish: { Args: never; Returns: undefined }
      exp_ring_stamp_tick: { Args: { batch?: number }; Returns: number }
      exp_scope_canon: { Args: { p_gcid?: string }; Returns: number }
      exp_score_v5_explain: {
        Args: { p_entity_id: string; p_entity_type?: string }
        Returns: Json
      }
      exp_score_v5_persist: {
        Args: { p_entity_id: string; p_entity_type?: string }
        Returns: Json
      }
      exp_search_backfill_enqueue: { Args: never; Returns: Json }
      exp_search_completeness_pct: {
        Args: { p_present: string[]; p_required: Json }
        Returns: number
      }
      exp_search_job_install: { Args: never; Returns: Json }
      exp_search_num: { Args: { p: string }; Returns: number }
      exp_search_project: { Args: { p_entity_ids?: string[] }; Returns: Json }
      exp_search_project_tick: { Args: { p_batch?: number }; Returns: Json }
      exp_search_projection: {
        Args: { p_entity_ids?: string[] }
        Returns: {
          city: string
          claimed: boolean
          completeness_pct: number
          entity_id: string
          entity_type: string
          fts: unknown
          gcid: string
          is_demo: boolean
          languages: string[]
          lat: number
          lng: number
          name: string
          photo_url: string
          rank_score: number
          rating: number
          review_count: number
          score_basis: string
          sections_present: string[]
          slug: string
          state: string
          title: string
          zip: string
        }[]
      }
      exp_sec_collect: { Args: never; Returns: undefined }
      exp_sec_tick: { Args: never; Returns: undefined }
      exp_sentinel: { Args: never; Returns: undefined }
      exp_sentinel_tick: { Args: never; Returns: undefined }
      exp_set_expected_volume: {
        Args: {
          p_gcid: string
          p_lane: string
          p_rationale?: string
          p_scope: string
          p_value: number
        }
        Returns: number
      }
      exp_sf_apply: { Args: { p_f: Json; p_url: string }; Returns: string }
      exp_sf_fetch_tick: { Args: { p_limit?: number }; Returns: Json }
      exp_sf_nodalize: {
        Args: { p_f: Json; p_office: string; p_pro: string; p_url: string }
        Returns: number
      }
      exp_sf_parse: { Args: { p_html: string; p_url: string }; Returns: Json }
      exp_sf_parse_tick: { Args: { p_limit?: number }; Returns: Json }
      exp_sf_platform: { Args: { u: string }; Returns: string }
      exp_sf_renodalize_tick: { Args: { p_batch?: number }; Returns: number }
      exp_sf_strip: { Args: { t: string }; Returns: string }
      exp_should_insert: {
        Args: {
          p_gcid: string
          p_kind: string
          p_label: string
          p_source: string
        }
        Returns: Json
      }
      exp_sitemap_rebuild: { Args: never; Returns: Json }
      exp_task_reminders_tick: { Args: { p_now?: string }; Returns: number }
      exp_territory_group_profiles: {
        Args: { p_group_key: string }
        Returns: {
          group_key: string
          locations: number
          logo_gcid: string
          logo_id: string
          logo_name: string
          professionals: number
        }[]
      }
      exp_territory_logo_profiles: {
        Args: never
        Returns: {
          group_key: string
          locations: number
          logo_gcid: string
          logo_id: string
          logo_name: string
          professionals: number
        }[]
      }
      exp_trust_rank: { Args: { p_trust: string }; Returns: number }
      exp_url_domain: { Args: { u: string }; Returns: string }
      exp_validate_brand_lane: {
        Args: { p_gcid: string }
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_validate_category: {
        Args: { p_gcid: string }
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_validate_category_core: {
        Args: { p_gcid: string }
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_validate_category_full: {
        Args: { p_gcid: string }
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_validate_crosslayer: {
        Args: { p_gcid: string }
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_validate_gbp_coverage: {
        Args: { p_gcid: string }
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_validate_graph: {
        Args: never
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_validate_mve: {
        Args: { p_gcid: string }
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_validate_pro_lane: {
        Args: { p_gcid: string }
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_validate_pro_person: {
        Args: { p_gcid: string }
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_validate_profile: { Args: { p_entity: string }; Returns: Json }
      exp_validate_richness: {
        Args: { p_gcid: string }
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_validate_schemaorg: {
        Args: { p_gcid: string }
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_validate_secondaries: {
        Args: { p_gcid: string }
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_validate_wave: {
        Args: { p_gcid: string }
        Returns: {
          check_code: string
          detail: string
          passed: boolean
        }[]
      }
      exp_xmp_brand_overview: { Args: { p_brand: string }; Returns: Json }
      exp_xmp_offices_page: {
        Args: {
          p_brand: string
          p_limit?: number
          p_offset?: number
          p_q?: string
          p_state?: string
        }
        Returns: {
          address_city: string
          address_state: string
          claimed: boolean
          id: string
          name: string
          pro_count: number
          search_rank_score: number
          slug: string
          total_count: number
        }[]
      }
      exp_xmp_state_rollup: {
        Args: { p_brand: string; p_limit?: number }
        Returns: {
          claimed: number
          offices: number
          pros: number
          reviews: number
          state: string
          with_bio: number
          with_photo: number
        }[]
      }
      exp_xmp_top_depth: {
        Args: { p_brand: string; p_limit?: number }
        Returns: {
          address_city: string
          address_state: string
          display_name: string
          id: string
          node_count: number
          slug: string
        }[]
      }
      exp_xmp_top_pros_score: {
        Args: { p_brand: string; p_limit?: number }
        Returns: {
          address_city: string
          address_state: string
          claimed: boolean
          display_name: string
          id: string
          search_rank_score: number
          slug: string
        }[]
      }
      exp_xmp_top_reviews: {
        Args: { p_brand: string; p_limit?: number }
        Returns: {
          avg_rating: number
          display_name: string
          id: string
          review_count: number
          slug: string
        }[]
      }
      has_control_role: {
        Args: { _role: string; _user_id: string }
        Returns: boolean
      }
      list_control_users: {
        Args: never
        Returns: {
          created_at: string
          email: string
          last_sign_in_at: string
          user_id: string
        }[]
      }
      m4_add_line: {
        Args: {
          p_actor?: string
          p_billing_mode?: string
          p_code: string
          p_contract: string
          p_discount_pct?: number
          p_qty?: number
          p_term_months?: number
          p_unit_price?: number
        }
        Returns: string
      }
      m4_add_recipient: {
        Args: {
          p_actor?: string
          p_contract: string
          p_email: string
          p_name: string
          p_order?: number
          p_party: string
          p_role: string
        }
        Returns: string
      }
      m4_add_version: {
        Args: {
          p_changes?: Json
          p_contract: string
          p_kind: string
          p_label: string
          p_source?: string
          p_uploaded_by: string
        }
        Returns: number
      }
      m4_assemble_document: {
        Args: { p_actor?: string; p_contract: string }
        Returns: Json
      }
      m4_calc_overage: {
        Args: { p_contract: string; p_pe: string; p_ps: string }
        Returns: Json
      }
      m4_complete: { Args: { p_contract: string }; Returns: undefined }
      m4_create_addendum: {
        Args: {
          p_actor?: string
          p_kind: string
          p_parent: string
          p_title?: string
        }
        Returns: string
      }
      m4_create_contract_from_quote: {
        Args: { p_created_by?: string; p_quote_id: string }
        Returns: string
      }
      m4_decide_approval: {
        Args: {
          p_actor: string
          p_approval: string
          p_reason: string
          p_status: string
        }
        Returns: undefined
      }
      m4_enqueue_email: {
        Args: {
          p_body: string
          p_entity: string
          p_name: string
          p_payload: Json
          p_subject: string
          p_template: string
          p_to: string
          p_when?: string
        }
        Returns: string
      }
      m4_finalize: {
        Args: { p_actor?: string; p_contract: string }
        Returns: Json
      }
      m4_generate_invoice: {
        Args: {
          p_actor?: string
          p_contract: string
          p_pe?: string
          p_ps?: string
          p_type: string
        }
        Returns: string
      }
      m4_generate_renewal_notice: {
        Args: { p_actor?: string; p_contract: string }
        Returns: string
      }
      m4_log: {
        Args: {
          p_actor: string
          p_contract: string
          p_detail?: Json
          p_event: string
        }
        Returns: undefined
      }
      m4_notify: {
        Args: {
          p_body: string
          p_entity: string
          p_kind: string
          p_link: string
          p_title: string
          p_user: string
        }
        Returns: undefined
      }
      m4_outbox_drain: { Args: never; Returns: number }
      m4_recalc_totals: { Args: { p_contract: string }; Returns: undefined }
      m4_record_nonrenewal_notice: {
        Args: { p_actor?: string; p_contract: string; p_source?: string }
        Returns: Json
      }
      m4_record_signature: {
        Args: {
          p_data: string
          p_identity: string
          p_ip: string
          p_token: string
          p_type: string
          p_ua: string
        }
        Returns: Json
      }
      m4_record_usage: {
        Args: {
          p_actor?: string
          p_code: string
          p_contract: string
          p_high_water?: number
          p_measured: number
          p_metric: string
          p_period_end: string
          p_period_start: string
        }
        Returns: string
      }
      m4_remove_line: {
        Args: { p_actor?: string; p_line: string }
        Returns: undefined
      }
      m4_remove_recipient: {
        Args: { p_actor?: string; p_recipient: string }
        Returns: undefined
      }
      m4_renewal_escalate: {
        Args: { p_contract: string; p_days: number; p_reason: string }
        Returns: undefined
      }
      m4_renewal_sweep: { Args: never; Returns: number }
      m4_request_approval: {
        Args: {
          p_actor?: string
          p_contract: string
          p_email: string
          p_name: string
          p_role: string
        }
        Returns: string
      }
      m4_resolve_renewal_recipients: {
        Args: { p_contract: string }
        Returns: Json
      }
      m4_selftest: { Args: { p_quote: string }; Returns: Json }
      m4_send_for_signature: {
        Args: { p_actor?: string; p_contract: string }
        Returns: number
      }
      m4_signer_fetch: { Args: { p_token: string }; Returns: Json }
      m4_start_renewal: {
        Args: { p_actor?: string; p_contract: string }
        Returns: string
      }
      nearby_cities: {
        Args: {
          p_city?: string
          p_lat?: number
          p_limit?: number
          p_lng?: number
          p_state?: string
        }
        Returns: {
          city: string
          distance_miles: number
          label: string
          population: number
          profile_count: number
          state_abbr: string
        }[]
      }
      public_ad_units: {
        Args: { p_context: string; p_gcid: string; p_geo: string }
        Returns: {
          context: string
          creative: Json
          id: string
          name: string
          specificity: number
          target_gcid: string
          target_geo: string
        }[]
      }
      public_page_view_ping: {
        Args: {
          p_claim_cta?: boolean
          p_gcid: string
          p_geo_type?: string
          p_geo_value: string
        }
        Returns: undefined
      }
      public_sponsored_slots: {
        Args: { p_gcid: string; p_geo: string }
        Returns: {
          advertiser_name: string
          advertiser_org_id: string
          doc_city: string
          doc_claimed: boolean
          doc_completeness_pct: number
          doc_entity_type: string
          doc_name: string
          doc_photo_url: string
          doc_rank_score: number
          doc_rating: number
          doc_review_count: number
          doc_slug: string
          doc_state: string
          doc_title: string
          doc_zip: string
          slot_id: string
          slot_position: number
        }[]
      }
      safe_jsonb: { Args: { t: string }; Returns: Json }
      search_docs: {
        Args: {
          p_claimed?: boolean
          p_gcid?: string
          p_limit?: number
          p_loc?: string
          p_min_rating?: number
          p_offset?: number
          p_q?: string
          p_sort?: string
        }
        Returns: {
          city: string
          claimed: boolean
          completeness_pct: number
          entity_id: string
          entity_type: string
          gcid: string
          id: string
          lat: number
          lng: number
          name: string
          photo_url: string
          rank_score: number
          rating: number
          review_count: number
          slug: string
          state: string
          title: string
          zip: string
        }[]
      }
      search_docs_count: {
        Args: {
          p_claimed?: boolean
          p_gcid?: string
          p_loc?: string
          p_min_rating?: number
          p_q?: string
        }
        Returns: number
      }
      search_docs_facets: {
        Args: {
          p_claimed?: boolean
          p_gcid?: string
          p_loc?: string
          p_min_rating?: number
          p_q?: string
        }
        Returns: Json
      }
      search_docs_suggest: {
        Args: { p_limit?: number; p_q: string }
        Returns: {
          city: string
          entity_type: string
          gcid: string
          id: string
          name: string
          photo_url: string
          rank_score: number
          slug: string
          state: string
          title: string
        }[]
      }
      sf_collect: { Args: never; Returns: undefined }
      sf_resolve: { Args: never; Returns: undefined }
      sf_tick: { Args: never; Returns: undefined }
      sfh_collect: { Args: never; Returns: undefined }
      sfh_tick: { Args: never; Returns: undefined }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
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
