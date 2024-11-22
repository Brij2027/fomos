let debounceTimer;

const apiBaseUrl = "https://fomos.vercel.app"

document.getElementById("searchBtn").addEventListener("click", (event) => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        handleSearch(event); // Call the main search handler
    }, 300); // Delay in milliseconds
});

async function handleSearch(event) {
    const searchBtn = document.getElementById("searchBtn");
    searchBtn.disabled = true; // Disable the button

    console.log("Search button clicked");
    event.preventDefault();
    document.getElementById("loadingScreen").classList.remove("hidden");

    const query = document.getElementById("searchQuery").value.trim();
    if (!query) {
        alert("Please enter a search term.");
        searchBtn.disabled = false;
        return;
    }

    try {
        // Step 1: Scrape data
        console.log("Fetching raw data...");
        const rawResults = await scrapeData(query);
        console.log("Raw results received:", rawResults);

        // Step 2: Process data for comparison
        console.log("Processing and grouping data...");
        let groupedResults = await fetchComparisonData(rawResults);
        console.log("Grouped results received:", groupedResults);

        //step 3: group products
        groupedResults = groupProducts(groupedResults);

        // Step 3: Display results
        displayResults(groupedResults);
    } catch (err) {
        console.error("Error during search:", err);
    } finally {
        searchBtn.disabled = false; // Re-enable the button
    }
}

async function scrapeData(query) {
    return fetch(`${apiBaseUrl}/scrape?query=${encodeURIComponent(query)}`)
        .then((response) => {
            if (!response.ok) throw new Error("Failed to fetch scraped data");
            return response.json();
        })
        .catch((err) => {
            console.error("Error fetching scraped data:", err);
            throw err;
        });
}

const fetchComparisonData = async (products) => {
    try {
        const response = await fetch(`${apiBaseUrl}/compare`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(products) ,
        });

        if (!response.ok) {
            throw new Error("Failed to fetch comparison data");
        }

        const data = await response.json();
        return data.enrichedProducts;
    } catch (err) {
        console.error("Error fetching comparison data:", err);
    }
};

function groupProducts(products) {
    const grouped = {};

    products.forEach((product) => {
        // Use `imageHash` as primary key and fallback to `normalizedTitle`
        const key = product.imageHash || product.normalizedTitle;

        if (!grouped[key]) {
            grouped[key] = []; // Create a new group if not already present
        }

        grouped[key].push(product); // Add product to the appropriate group
    });

    // Convert grouped object to an array of arrays
    return Object.values(grouped);
}

function displayResults(groupedProducts) {
    const resultsContainer = document.getElementById("resultsContainer");
    resultsContainer.innerHTML = ""; // Clear previous results

    groupedProducts.forEach((group) => {
        const mainProduct = group[0]; // Use the first product in the group as the representative
        const otherPrices = group.slice(1).map(
            (product) => `
                <div class="other-price-item">
                    <strong><a href="${product.url}" target="_blank">${product.name}</a>:</strong> 
                    <span class="price">${product.price}</span>
                </div>
            `
        );

        const groupCard = document.createElement("div");
        groupCard.classList.add("result-group");

        groupCard.innerHTML = `
            <div class="product-card">
                <h3>Product: ${mainProduct.title}</h3>
                <img src="${mainProduct.image}" alt="${mainProduct.title}" />
                <p><strong>Primary Source:</strong> <a href="${mainProduct.url}" target="_blank">${mainProduct.name}</a></p>
                <p><strong>Primary Price:</strong> ${mainProduct.price}</p>
                <h4>Other Prices:</h4>
                ${otherPrices.length > 0 ? otherPrices.join("") : "<p>No other sources available</p>"}
            </div>
        `;
        resultsContainer.appendChild(groupCard);
    });

    document.getElementById("results").classList.remove("hidden");
    document.getElementById("goBackBtn").classList.remove("hidden");
    document.getElementById("searchSection").classList.add("hidden");
    document.getElementById("loadingScreen").classList.add("hidden");
}


document.getElementById("goBackBtn").addEventListener("click", () => {
    // Hide the results and "Go Back" button
    document.getElementById("results").classList.add("hidden");
    document.getElementById("goBackBtn").classList.add("hidden");

    // Show the search section again
    document.getElementById("searchSection").classList.remove("hidden");
});