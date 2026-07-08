require('dotenv').config();
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST,
  port: parseInt(process.env.EMAIL_PORT) || 587,
  secure: process.env.EMAIL_SECURE === 'true',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

const APP_URL = process.env.APP_URL || 'http://localhost:3000';

function tripTable(trip) {
  return `
    <table style="border-collapse:collapse;width:100%;font-family:sans-serif;font-size:14px">
      <tr style="background:#f3f4f6"><th style="padding:8px 12px;text-align:left;border:1px solid #e5e7eb">Field</th><th style="padding:8px 12px;text-align:left;border:1px solid #e5e7eb">Value</th></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb">Tracking No.</td><td style="padding:8px 12px;border:1px solid #e5e7eb"><strong>${trip.tracking_no}</strong></td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb">Type</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${trip.trip_type === 'international' ? 'International' : 'Domestic'}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb">Traveller</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${trip.traveller_name}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb">Customer</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${trip.customer_name || '—'}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb">Route</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${trip.travel_route || '—'}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb">Dates</td><td style="padding:8px 12px;border:1px solid #e5e7eb">${trip.travel_start_date || '—'} → ${trip.travel_end_date || '—'}</td></tr>
      <tr><td style="padding:8px 12px;border:1px solid #e5e7eb">Total (INR)</td><td style="padding:8px 12px;border:1px solid #e5e7eb"><strong>₹${Number(trip.grand_total_inr || 0).toLocaleString('en-IN')}</strong></td></tr>
    </table>`;
}

async function sendWorkflowEmail({ to, subject, heading, body, trip, actionUrl, actionLabel }) {
  if (!process.env.EMAIL_USER) return; // skip if email not configured

  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#1A1F2E;padding:20px 28px;border-radius:8px 8px 0 0">
        <span style="color:#fff;font-size:18px;font-weight:600">Yantriki</span>
        <span style="color:#8B93A7;font-size:13px;margin-left:10px">Travel Expense Portal</span>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-top:none;padding:28px;border-radius:0 0 8px 8px">
        <h2 style="color:#1A1F2E;font-size:18px;margin:0 0 8px">${heading}</h2>
        <p style="color:#6B7280;font-size:14px;margin:0 0 20px">${body}</p>
        ${tripTable(trip)}
        ${actionUrl ? `<div style="margin-top:24px"><a href="${actionUrl}" style="background:#E8720C;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:500">${actionLabel || 'View in portal'}</a></div>` : ''}
      </div>
      <p style="color:#9CA3AF;font-size:12px;text-align:center;margin-top:16px">Yantriki Technocontrol Systems Pvt. Ltd.</p>
    </div>`;

  await transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html
  });
}

// Workflow email triggers
async function onTripSubmitted(trip, reviewerEmail) {
  await sendWorkflowEmail({
    to: reviewerEmail || process.env.EMAIL_TO,
    subject: `[Action needed] Trip submitted — ${trip.tracking_no}`,
    heading: 'A trip has been submitted for your review',
    body: `${trip.traveller_name} has submitted a travel expense report. Please review and take action.`,
    trip,
    actionUrl: `${APP_URL}/`,
    actionLabel: 'Review now →'
  });
}

async function onTripReturned(trip, traveller_email, comment) {
  await sendWorkflowEmail({
    to: traveller_email || process.env.EMAIL_TO,
    subject: `[Revision needed] Trip returned — ${trip.tracking_no}`,
    heading: 'Your trip submission has been returned',
    body: `Your expense report has been returned for revision. Reviewer comment: <em>${comment || '—'}</em>`,
    trip,
    actionUrl: `${APP_URL}/`,
    actionLabel: 'Edit submission →'
  });
}

async function onTripReviewed(trip, approverEmail) {
  await sendWorkflowEmail({
    to: approverEmail || process.env.EMAIL_TO,
    subject: `[Action needed] Trip ready for approval — ${trip.tracking_no}`,
    heading: 'A trip is ready for your approval',
    body: `${trip.traveller_name}'s expense report has been reviewed and is awaiting your approval.`,
    trip,
    actionUrl: `${APP_URL}/`,
    actionLabel: 'Approve now →'
  });
}

async function onTripApproved(trip, accountsEmail, directorsEmail) {
  const recipients = [accountsEmail, directorsEmail, process.env.EMAIL_TO].filter(Boolean).join(',');
  await sendWorkflowEmail({
    to: recipients,
    subject: `[FYI] Trip approved — ${trip.tracking_no}`,
    heading: 'Travel expense approved',
    body: `${trip.traveller_name}'s expense of ₹${Number(trip.grand_total_inr).toLocaleString('en-IN')} has been approved and is pending accounts journaling.`,
    trip,
    actionUrl: `${APP_URL}/`,
    actionLabel: 'View in portal →'
  });
}

async function onTripPaid(trip, travellerEmail) {
  await sendWorkflowEmail({
    to: travellerEmail || process.env.EMAIL_TO,
    subject: `[Payment cleared] Trip — ${trip.tracking_no}`,
    heading: 'Your expense has been cleared for payment',
    body: `Your travel expense of ₹${Number(trip.grand_total_inr).toLocaleString('en-IN')} has been cleared for payment.`,
    trip
  });
}

module.exports = { onTripSubmitted, onTripReturned, onTripReviewed, onTripApproved, onTripPaid };