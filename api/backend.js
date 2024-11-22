const axios = require('axios');
const cheerio = require('cheerio');
const puppeteer = require('puppeteer');
const express = require('express');
const crypto = require('crypto');
const app = express();
const cors = require('cors');
const path = require('path');

// Enable CORS for the frontend
app.use(cors());
app.use(express.json()); // To parse JSON request bodies
app.use(express.urlencoded({ extended: true })); // To parse URL-encoded request bodies

app.use(express.static(path.join(__dirname, '../public')));

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, '../public', 'index.html'));
});

// Normalize titles for comparison
function normalizeTitle(title) {
    return title.toLowerCase().replace(/[^a-z0-9]/gi, '').trim();
}

async function hashImage(imageUrl) {
    try {
        // Download image
        const response = await axios.get(imageUrl, { responseType: 'arraybuffer' });
        const buffer = Buffer.from(response.data);

        // Hash the buffer
        const hash = crypto.createHash('md5').update(buffer).digest('hex'); // Change algorithm if needed
        return hash;
    } catch (err) {
        console.error(`Error processing image (${imageUrl}):`, err.message);
        return `fallback-${Math.random().toString(36).substring(2, 10)}`;
    }
}

async function enrichProducts(products) {
    const enrichedProducts = [];
    for (const product of products) {
        const normalizedTitle = normalizeTitle(product.title);
        const hash = await hashImage(product.image);

        enrichedProducts.push({
            ...product,
            normalizedTitle,
            imageHash: hash ? hash : product.image,
        });
    }
    return enrichedProducts;
}

async function snapdealScrape($, site) {
    const products = [];
    $('.product-tuple-listing').each((index, element) => {
        const title = $(element).find('.product-title').text().trim() || "No title";
        const price = $(element).find('.product-price').text().trim() || "No price";
        const originalPrice = $(element).find('.product-desc-price.strike').text().trim() || "No original price";
        const discount = $(element).find('.product-discount span').text().trim() || "No discount";
        let imageUrl = $(element).find('.product-tuple-image img').attr('src');
        if (!imageUrl) {
            imageUrl = $(element).find('.product-tuple-image picture source').attr('srcset');
        }
        imageUrl = imageUrl || "No image";        
        const productUrl = $(element).find('.dp-widget-link').attr('href');
        const completeProductUrl = productUrl ? productUrl : "No URL";
        const widthElement = $(element).find('.rating-stars  .filled-stars');
        const widthStyle = widthElement.css('width') || "0px";
        const width = parseFloat(widthStyle.replace('%', ''));
        const starRating = (parseFloat(width) / 100) * 5 || 0;

        const reviewsElement = $(element).find('.product-rating-count');
        const reviewsCountText = reviewsElement.text().replace("(", "").replace(")", "") || "0";
        products.push({
            name: site.name,
            title,
            price,
            originalPrice,
            discount,
            rating: starRating.toFixed(1), // e.g., 4.2
            reviews: reviewsCountText, // e.g., 14
            image: imageUrl,
            url: completeProductUrl,
        });
    });
    return products;
}

async function jioMartScrape(query) {
    const products = [];
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();

    // Go to JioMart's page
    await page.goto(`https://www.jiomart.com/search/${query}`, { waitUntil: 'networkidle2' });

    // Wait for product cards to load
    await page.waitForSelector('.ais-InfiniteHits-list');

    // Get product details
    const scrapedProducts = await page.evaluate(() => {
        const productElements = document.querySelectorAll('.ais-InfiniteHits-item');
        const products = [];

        productElements.forEach((element) => {
            const title = element.querySelector('.plp-card-details-name')?.textContent.trim() || "No title";
            const price = element.querySelector('.plp-card-details-price span.jm-heading-xxs')?.textContent.trim() || "No price";
            const imageUrl = element.querySelector('.plp-card-image img')?.getAttribute('data-src') || "No image";
            const productUrl = element.querySelector('a.plp-card-wrapper')?.getAttribute('href') || "No URL";

            // Build the complete product URL
            const completeProductUrl = productUrl.startsWith('http') ? productUrl : `https://www.jiomart.com${productUrl}`;

            products.push({
                name: "Jiomart",
                title,
                price,
                image: imageUrl,
                url: completeProductUrl,
                rating: "N/A",
                reviews: "No reviews",
            });
        });

        return products;
    });

    products.push(...scrapedProducts);

    await browser.close();
    return products;
}

async function amazonScrape($, site){
    const products = [];
    $(site.titleRule).each((index, element) => {
        const title = $(element).find('h2 span').text().trim();
        const priceContainer = $(element).nextAll('div').find(site.priceRule);
        const priceSymbol = priceContainer.find('.a-price-symbol').text().trim() || "N/A";
        const priceWhole = priceContainer.find('.a-price-whole').text().trim() || "N/A";
        const price = priceSymbol + priceWhole;
        const rating = $(site.ratingRule).eq(index).text().trim() || "N/A";
        const reviewsCount = $(site.reviewsCountRule).eq(index).text().trim() || "No reviews";
        const imageUrl = $(element).parent().parent().find(site.imageRule).attr('src') || "No image available";
        const productUrl = $(element).find('h2 a').attr("href");

        products.push({
            name: site.name,
            title,
            price,
            rating,
            reviews: reviewsCount,
            image: imageUrl,
            url: productUrl ? `https://www.${site.name.toLowerCase()}.in${productUrl}` : site.url,
        });
    });

    return products
}

app.get("/scrape", async (req, res) => {
    const query = req.query.query;
    const websites = [
        {
            name: "Jiomart",
            url: `https://www.jiomart.com/search/${query}`,
        },
        {
            name: "Amazon",
            url: `https://www.amazon.in/s?k=${query}`,
            priceRule: '.a-price', // Price rule for Amazon
            titleRule: '[data-cy="title-recipe"]', // Title rule for Amazon
            imageRule: ".s-product-image-container .s-image", // Image rule for Amazon
            ratingRule: "span.a-declarative .a-icon-alt", // Rating rule for Amazon
            reviewsCountRule: "#acrCustomerReviewText", // Reviews count for Amazon
        },
        {
            name: "Snapdeal",
            url: `https://www.snapdeal.com/search?keyword=${query}`,
        }
    ];

    let results = [];

    // Loop through each website (Flipkart, Amazon)
    for (const site of websites) {
        try {
            const { data } = await axios.get(site.url, {
                headers: {
                    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36",
                },
            });

            const $ = cheerio.load(data);

            // Collecting all products data from the current site
            if (site.name === "Amazon") {
                products = await amazonScrape($, site);
            } else if (site.name === "Jiomart") {
                products = await jioMartScrape(query);
            } else if (site.name === "Snapdeal") {
                products = await snapdealScrape($, site);
            }
            results.push(...products);
        } catch (err) {
            console.error(`Error scraping ${site.name}:`, err.message);
        }
    }
    res.json(results);
});

app.post('/compare', async (req, res) => {

    let products = req.body;

    // If it's an object, try to convert it to an array.
    if (!Array.isArray(products)) {
        if (typeof products === "object" && products !== null) {
            products = Object.values(products); // Converts object to an array of values
        } else {
            return res.status(400).json({ error: "Invalid format: Expected an array of products" });
        }
    }

    try {
        const enrichedProducts = await enrichProducts(products);
        return res.json({ enrichedProducts });
    } catch (err) {
        console.error("Error during comparison:", err);
        res.status(500).json({ error: 'Internal server error' });
    }
});

module.exports = (req, res) => {
    app(req, res);  // This will handle the API requests
};