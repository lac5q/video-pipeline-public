#!/usr/bin/env node
/**
 * Initialize database with sample data at specific location
 */

const path = require('path');
const { getDatabase } = require('./lib/db');

// Force the database to be created at /data/pipeline.db
process.env.DB_PATH = '/data/pipeline.db';

function initializeSampleData() {
  const db = getDatabase();
  
  // Create sample orders
  const insertOrder = db.prepare(`
    INSERT OR REPLACE INTO orders (
      order_id, brand, customer_email, customer_name, illustration_url, photo_urls,
      order_date, production_status, consent_status, computed_score, priority, notes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  
  const sampleOrders = [
    {
      order_id: 'TY-133627',
      brand: 'turnedyellow',
      customer_email: 'customer1@example.com',
      customer_name: 'John Doe',
      illustration_url: 'https://example.com/illus1.jpg',
      photo_urls: JSON.stringify(['https://example.com/photo1.jpg']),
      order_date: new Date().toISOString(),
      production_status: 'candidate',
      consent_status: 'pending',
      computed_score: 95.5,
      priority: 1,
      notes: 'Sample order for testing'
    },
    {
      order_id: 'MMJ-45678',
      brand: 'makemejedi',
      customer_email: 'customer2@example.com',
      customer_name: 'Jane Smith',
      illustration_url: 'https://example.com/illus2.jpg',
      photo_urls: JSON.stringify(['https://example.com/photo2.jpg', 'https://example.com/photo3.jpg']),
      order_date: new Date(Date.now() - 86400000).toISOString(), // yesterday
      production_status: 'approved',
      consent_status: 'pending',
      computed_score: 87.2,
      priority: 2,
      notes: 'Another sample order'
    },
    {
      order_id: 'TY-98765',
      brand: 'turnedyellow',
      customer_email: 'customer3@example.com',
      customer_name: 'Bob Johnson',
      illustration_url: 'https://example.com/illus3.jpg',
      photo_urls: JSON.stringify(['https://example.com/photo4.jpg']),
      order_date: new Date(Date.now() - 172800000).toISOString(), // 2 days ago
      production_status: 'video_built',
      consent_status: 'approved',
      computed_score: 92.1,
      priority: 3,
      notes: 'Video built sample order'
    }
  ];
  
  for (const order of sampleOrders) {
    insertOrder.run(
      order.order_id,
      order.brand,
      order.customer_email,
      order.customer_name,
      order.illustration_url,
      order.photo_urls,
      order.order_date,
      order.production_status,
      order.consent_status,
      order.computed_score,
      order.priority,
      order.notes
    );
  }
  
  console.log(`Inserted ${sampleOrders.length} sample orders into database at /data/pipeline.db`);
  db.close();
}

initializeSampleData().catch(console.error);