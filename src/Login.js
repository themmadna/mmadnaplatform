import React from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from './supabaseClient';

const LoginPage = () => {
  return (
    <div style={{ 
      maxWidth: '400px', 
      margin: '100px auto', 
      padding: '20px', 
      background: '#1a1a1a', 
      borderRadius: '8px',
      color: 'white' 
    }}>
      <h2 style={{ textAlign: 'center' }}>UFC Fight Ratings Login</h2>
      <Auth
        supabaseClient={supabase}
        appearance={{ theme: ThemeSupa }}
        theme="dark"
        providers={[]} // We are just using Email/Password for now
      />
    </div>
  );
};

export default LoginPage;