import { ScrollView, StyleSheet } from 'react-native';

import { Bullets, Closing, Dates, H1, H2, P } from '@/components/Prose';
import { Screen } from '@/components/ui/Screen';
import { Spacing } from '@/theme/colors';

// Public Terms of Service — full port of the web app's TosPage.js. No login
// required; the header (title + back) is provided by the root Stack.Screen.
export default function TosScreen() {
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scroll}>
        <H1>FetchIt Terms of Service</H1>
        <Dates effective="June 12, 2026" updated="June 12, 2026" />

        <P>
          Please read these Terms of Service ("Terms", "Agreement") carefully
          before using the FetchIt platform, website, mobile application, or any
          related services (collectively, the "Service") operated by FetchIt
          ("Company", "we", "us", or "our"). By accessing or using the Service,
          creating an account, or completing a purchase through the Service, you
          ("User", "you", or "your") agree to be bound by these Terms in their
          entirety. If you do not agree to these Terms, you must not access or use
          the Service.
        </P>

        <H2>1. Acceptance of Terms</H2>
        <P>
          By creating an account, clicking "I Agree," completing the onboarding
          process, or otherwise accessing or using any portion of the FetchIt
          Service, you acknowledge that you have read, understood, and agree to be
          legally bound by these Terms of Service and our Privacy Policy, which is
          incorporated herein by reference. These Terms constitute a legally
          binding agreement between you and FetchIt. FetchIt reserves the right to
          update, modify, or replace these Terms at any time at its sole
          discretion.
        </P>

        <H2>2. Description of Service</H2>
        <P>
          FetchIt is an artificial intelligence-powered shopping assistant
          platform that enables users to search for products, receive
          personalized recommendations, and facilitate automated purchase orders
          from third-party retailers including but not limited to Amazon.com.
          FetchIt acts solely as an intermediary and facilitator between users and
          third-party retailers. FetchIt is not a retailer, seller, or merchant,
          and does not hold, stock, ship, or take title to any products ordered
          through the Service.
        </P>

        <H2>3. Eligibility</H2>
        <P>
          You must be at least 18 years of age to use the Service. The Service is
          currently available to users in the United States only.
        </P>

        <H2>4. Account Registration and Security</H2>
        <P>
          You are solely responsible for maintaining the confidentiality of your
          account credentials. You may not share your account credentials with any
          third party except as expressly permitted under a Max plan family
          membership. FetchIt reserves the right to suspend or terminate your
          account at any time for any violation of these Terms.
        </P>

        <H2>5. Subscription Plans and Billing</H2>
        <P>
          FetchIt offers Free ($0), Plus ($4.99/mo), Pro ($19.99/mo), and Max
          ($99.99/mo) plans. All subscription fees are non-refundable except as
          required by applicable law. Subscriptions renew automatically unless
          cancelled.
        </P>

        <H2>6. Usage Limits and Token Allocation</H2>
        <Bullets
          items={[
            'Free Plan: 50,000 tokens per 5-hour window; 100,000 tokens per week',
            'Plus Plan: 130,000 tokens per 5-hour window; 355,000 tokens per week',
            'Pro Plan: 325,000 tokens per 5-hour window; 1,811,000 tokens per week',
            'Max Plan: 1,625,000 tokens per 5-hour window; 9,579,000 tokens per week',
          ]}
        />

        <H2>7. Service Fees and Transaction Charges</H2>
        <P>
          In addition to your subscription fee, FetchIt charges a service fee on
          each successful order: orders below $20.00 incur a flat $2.00 fee;
          orders of $20.00 or more incur $1.00 plus 5% of the order value. Service
          fees are non-refundable regardless of order outcome.
        </P>

        <H2>8. Ordering Process and Third-Party Fulfillment</H2>
        <P>
          FetchIt uses third-party ordering APIs including Zinc Technologies to
          place orders on your behalf. FetchIt is not the retailer and is not
          party to the contract of sale between you and the retailer. Order
          cancellations and returns are governed by retailer policies. FetchIt's
          service fee is not refundable in connection with cancellations or
          returns.
        </P>

        <H2>9. Artificial Intelligence and Data Usage</H2>
        <P>
          The Service uses Grok 4.3 by xAI. Your interactions with the FetchIt AI
          assistant, including search queries, product preferences, purchase
          history, and conversation history, may be used by xAI and its affiliates
          to train, improve, and refine their artificial intelligence models. This
          data sharing is a condition of FetchIt's use of xAI's API and may not be
          opted out of while using the Service. If you do not consent to your data
          being used for AI model training, you must not use the Service.
        </P>

        <H2>10. User Responsibilities and Prohibited Conduct</H2>
        <P>
          You agree to use the Service only for lawful purposes. You may not
          circumvent usage limits, use automated bots, reverse engineer the
          Service, create multiple accounts to bypass restrictions, or use the
          Service fraudulently.
        </P>

        <H2>11. Shipping Address and Payment Information</H2>
        <P>
          You are responsible for ensuring your saved shipping address and payment
          method are accurate and current. FetchIt is not liable for failed
          deliveries or orders resulting from inaccurate information.
        </P>

        <H2>12. Max Plan Family Memberships</H2>
        <P>
          The Max Plan permits up to four additional family members under one
          subscription. The account owner is solely responsible for all orders and
          fees incurred by family members.
        </P>

        <H2>13. Privacy and Data Security</H2>
        <P>
          Shipping addresses are stored securely in FetchIt's database. Payment
          card details are never stored by FetchIt and are handled exclusively by
          Stripe. Shopping data may be shared with xAI as described in Section 9.
        </P>

        <H2>14. Intellectual Property</H2>
        <P>
          All content and features of the Service are the exclusive property of
          FetchIt or its licensors. You are granted a limited, non-exclusive,
          revocable license to use the Service for personal non-commercial use
          only.
        </P>

        <H2>15. Third-Party Services</H2>
        <P>
          The Service depends on Supabase, Stripe, Zinc Technologies, xAI, and
          third-party retailers. FetchIt is not responsible for the availability
          or practices of any third-party services.
        </P>

        <H2>16. Disclaimers and Limitation of Liability</H2>
        <P>
          THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF ANY KIND. FETCHIT
          SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL,
          OR PUNITIVE DAMAGES. FETCHIT'S TOTAL LIABILITY SHALL NOT EXCEED THE
          GREATER OF AMOUNTS PAID IN THE PRECEDING 12 MONTHS OR $100.00 USD. You
          agree to indemnify and hold harmless FetchIt from any claims arising from
          your use of the Service.
        </P>

        <H2>17. Dispute Resolution and Arbitration</H2>
        <P>
          All disputes shall be resolved by binding arbitration under AAA rules in
          Tennessee. You waive your right to participate in any class action
          lawsuit or class-wide arbitration.
        </P>

        <H2>18. Governing Law</H2>
        <P>These Terms are governed by the laws of the State of Tennessee.</P>

        <H2>19. Termination</H2>
        <P>
          FetchIt may terminate your access at any time for violations of these
          Terms. You may terminate your account through account settings.
          Subscription fees are non-refundable upon termination.
        </P>

        <H2>20. Miscellaneous</H2>
        <P>
          These Terms constitute the entire agreement between you and FetchIt.
          Contact: support@fetchit.com.
        </P>

        <Closing>
          By using FetchIt, you acknowledge that you have read these Terms of
          Service, understand them, and agree to be bound by them.
        </Closing>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingVertical: Spacing.lg, paddingBottom: Spacing.xxl },
});
