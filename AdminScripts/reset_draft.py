from supabase import create_client, Client

# Replace with your Supabase Project URL and Service Role Key (found in Project Settings > API)
# Use the SERVICE ROLE KEY so it can bypass any Row Level Security (RLS) rules you set up.
SUPABASE_URL = "https://YOUR_PROJECT_REF.supabase.co"
SUPABASE_SERVICE_KEY = "YOUR_SUPABASE_SERVICE_ROLE_KEY"

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

def reset_draft():
    print("=========================================")
    print("      DRAFT RESET UTILITY")
    print("=========================================")
    confirm = input("WARNING: This will permanently delete all draft picks and reset all players. Type 'RESET' to continue: ")
    
    if confirm != "RESET":
        print("Operation cancelled. No changes were made.")
        return

    try:
        # Step 1: Delete all draft picks
        print("1. Wiping the draft_picks table...")
        # Supabase requires a filter to perform bulk deletes. 
        # Using .neq("id", 0) ensures it targets all rows since your IDs are auto-incrementing positive integers.
        supabase.table("draft_picks").delete().neq("id", 0).execute()
        
        # Step 2: Reset all drafted players back to the available pool
        print("2. Resetting drafted players...")
        # We only update players where is_drafted is True to make the query fast and efficient
        supabase.table("players").update({"is_drafted": False}).eq("is_drafted", True).execute()

        print("\nSUCCESS: The draft board has been completely reset!")
        print("You can now refresh your GitHub Pages app to see a clean board.")

    except Exception as e:
        print(f"\nAn error occurred during reset: {e}")

if __name__ == "__main__":
    reset_draft()