#!/usr/bin/env node
/**
 * Utility to add sample orders from spreadsheet data
 * 
 * To use this:
 * 1. Copy the relevant data from your Google Sheets
 * 2. Format it as CSV or JSON
 * 3. Run this script with the data
 */

const { getDatabase } = require('./lib/db');

function addSampleOrdersFromData(ordersData) {
  const db = getDatabase();
  
  const insertOrder = db.prepare(`
    INSERT OR REPLACE INTO orders (
      order_id, brand, customer_email, customer_name, illustration_url, photo_urls,
      order_date, production_status, consent_status, computed_score, priority, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  let insertedCount = 0;
  
  for (const order of ordersData) {
    try {
      // Extract order_id from filename if not provided
      let orderId = order.order_id || order.fileName || '';
      if (orderId && orderId.includes('.')) {
        orderId = orderId.substring(0, orderId.lastIndexOf('.'));
      }
      
      // Skip if no order ID can be determined
      if (!orderId) continue;
      
      // Determine brand from spreadsheet context
      const brand = order.brand || 'turnedyellow'; // default to turnedyellow
      
      insertOrder.run(
        orderId,
        brand,
        order.customer_email || order.customerEmail || '',
        order.customer_name || order.customerName || '',
        order.illustration_url || order.illustrationUrl || order.omsLink || '',
        order.photo_urls || order.photoUrls || JSON.stringify([order.photosLink]).replace(/null/g, '""'),
        order.order_date || order.dateAdded || new Date().toISOString(),
        order.production_status || order.productionStatus || 'pending',
        order.consent_status || order.consentStatus || 'pre_approved',
        order.computed_score || order.score || 50,
        order.priority || 10,
        order.notes || `Imported from spreadsheet - ${order.description || 'No description'}`
      );
      
      insertedCount++;
    } catch (err) {
      console.error('Error inserting order:', order, err.message);
    }
  }
  
  console.log(`Inserted ${insertedCount} orders into database`);
  db.close();
}

// Example usage with sample data - replace this with actual data from your spreadsheets
const sampleOrders = [
  {
    fileName: "133627.mov",
    score: 95.5,
    photosLink: "https://example.com/photos/133627.zip",
    omsLink: "https://doh.turnedyellow.com/customer/illustration/133627",
    description: "Family portrait reaction video",
    brand: "turnedyellow"
  },
  {
    fileName: "130138.mov", 
    score: 87.2,
    photosLink: "https://example.com/photos/130138.zip",
    omsLink: "https://doh.turnedyellow.com/customer/illustration/130138",
    description: "Couple portrait reaction video",
    brand: "turnedyellow"
  },
  {
    fileName: "45678.mp4",
    score: 92.1,
    photosLink: "https://example.com/photos/45678.zip",
    omsLink: "https://theforce.makemejedi.com/customer/illustration/45678",
    description: "Star Wars fan art",
    brand: "makemejedi"
  }
];

// Uncomment the next line to add sample data (after customizing with your actual data)
// addSampleOrdersFromData(sampleOrders);

console.log("Sample data preparation script loaded.");
console.log("To add your own data:");
console.log("1. Extract data from your Google Sheets");
console.log("2. Format it as an array of objects");
console.log("3. Call addSampleOrdersFromData(yourDataArray)");