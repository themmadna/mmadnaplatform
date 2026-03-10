import React from 'react';
import { Auth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { supabase } from './supabaseClient';

const LoginPage = ({ onGuestContinue }) => {
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
      <div style={{ textAlign: 'center', marginTop: '20px' }}>
        <button
          onClick={onGuestContinue}
          style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer', fontSize: '14px', textDecoration: 'underline' }}
        >
          Continue as Guest
        </button>
        <p style={{ color: '#6b7280', fontSize: '12px', marginTop: '6px' }}>
          Votes and scores saved on this device only
        </p>
      </div>
    </div>
  );
};

export default LoginPage;