import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

function response(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return response({ error: "Method not allowed." }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return response({ error: "Login service is not configured." }, 500);

  try {
    const body = await request.json();
    const username = typeof body.username === "string" ? body.username.trim().toLowerCase() : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (!/^[a-z0-9._-]{1,64}$/.test(username) || !password || password.length > 1024) {
      return response({ error: "Enter a valid username and password." }, 400);
    }

    const adminClient = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const { data: lockData, error: lockError } = await adminClient.rpc("login_attempt_state", { p_username: username });
    if (lockError) throw lockError;
    if (lockData?.[0]?.is_locked) return response({ error: "Too many failed attempts. Try again in 15 minutes." }, 429);

    const { data: profile, error: profileError } = await adminClient
      .from("profiles").select("id,active").eq("username", username).maybeSingle();
    if (profileError) throw profileError;
    if (!profile?.active) {
      const { error } = await adminClient.rpc("record_login_attempt", { p_username: username, p_success: false });
      if (error) throw error;
      return response({ error: "Incorrect username or password." }, 401);
    }

    if (password.length < 8) {
      const { error } = await adminClient.rpc("record_login_attempt", { p_username: username, p_success: false });
      if (error) throw error;
      return response({ error: "Password must be at least 8 characters." }, 400);
    }

    const authResponse = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: anonKey },
      body: JSON.stringify({ email: `${username}@promokings.local`, password })
    });
    const authResult = await authResponse.json();
    if (!authResponse.ok) {
      const { error } = await adminClient.rpc("record_login_attempt", { p_username: username, p_success: false });
      if (error) throw error;
      return response({ error: "Incorrect username or password." }, 401);
    }
    const { error: resetError } = await adminClient.rpc("record_login_attempt", { p_username: username, p_success: true });
    if (resetError) throw resetError;
    return response({ session: authResult });
  } catch (error) {
    console.error("Login function failed", error);
    return response({ error: "Sign-in is temporarily unavailable. Try again shortly." }, 500);
  }
});
