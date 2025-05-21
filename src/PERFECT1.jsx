import React, { useState, useEffect } from 'react';
import * as am5 from '@amcharts/amcharts5';
import * as am5map from '@amcharts/amcharts5/map';
import am5geodata_worldLow from '@amcharts/amcharts5-geodata/worldLow';
import am5themes_Animated from '@amcharts/amcharts5/themes/Animated';
import Papa from 'papaparse';
import './App.css';
import countryNameToId from './constants/countryCodes';

// Reverse mapping for display names
const idToCountryName = Object.fromEntries(
  Object.entries(countryNameToId).map(([name, id]) => [id, name])
);

const App = () => {
  const [data, setData] = useState([]);
  const [error, setError] = useState(null);
  const [view, setView] = useState('overall');
  const [selectedCountry, setSelectedCountry] = useState('');
  const [selectedDetails, setSelectedDetails] = useState(null);

  // Load and parse CSV data
  useEffect(() => {
    console.log('Fetching /geo_sentiments.csv');
    fetch('/geo_sentiments.csv')
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `HTTP error: ${response.status} ${response.statusText}`
          );
        }
        return response.text();
      })
      .then((csv) => {
        console.log('CSV content (first 200 chars):', csv.slice(0, 200));
        const parsed = Papa.parse(csv, {
          header: true,
          skipEmptyLines: true,
          transform: (value) => value.trim(),
          complete: (results) => {
            console.log('Parsed headers:', results.meta.fields);
            console.log(
              'Parsed results (first 5 rows):',
              results.data.slice(0, 5)
            );
            return results.data;
          },
          error: (err) => {
            throw new Error('PapaParse error: ' + err);
          },
        });
        // Find header case-insensitively
        const headers = parsed.meta.fields;
        const countryHeader =
          headers.find((h) => h.toLowerCase() === 'country') || 'Country';
        const regionHeader =
          headers.find((h) => h.toLowerCase() === 'region') || 'Region';
        const valueHeader =
          headers.find((h) => h.toLowerCase() === 'randomvalue') ||
          'RandomValue';
        console.log('Using headers:', {
          countryHeader,
          regionHeader,
          valueHeader,
        });

        const data = parsed.data
          .map((row) => {
            const sentiment = parseInt(row[valueHeader], 10);
            return {
              country: row[countryHeader] || '',
              region: row[regionHeader] || '',
              sentiment: isNaN(sentiment) ? null : sentiment,
            };
          })
          .filter((row) => {
            const isValid =
              row.country &&
              row.sentiment !== null &&
              Number.isInteger(row.sentiment) &&
              row.sentiment >= 0 &&
              row.sentiment <= 2;
            if (!isValid) {
              console.log('Filtered out row:', row);
            }
            return isValid;
          });
        console.log('Filtered data (first 5 rows):', data.slice(0, 5));
        if (data.length === 0) {
          setError(
            'No valid data found. Check CSV format (headers: Country,Region,RandomValue).'
          );
        } else {
          setData(data);
        }
      })
      .catch((err) => {
        console.error('Fetch error:', err);
        setError(`Failed to load data: ${err.message}`);
      });
  }, []);

  // Aggregate data by country
  const aggregateData = (data) => {
    const countryData = {};
    data.forEach((row, index) => {
      const countryId =
        countryNameToId[row.country] || row.country.toUpperCase();
      const sentiment = row.sentiment;
      console.log(`Processing row ${index}:`, {
        country: row.country,
        countryId,
        sentiment,
      });
      if (!countryData[countryId]) {
        countryData[countryId] = {
          positive: 0,
          neutral: 0,
          negative: 0,
          displayName: row.country,
        };
      }
      if (sentiment === 2) countryData[countryId].positive++;
      else if (sentiment === 1) countryData[countryId].neutral++;
      else if (sentiment === 0) countryData[countryId].negative++;
    });
    const aggregated = Object.entries(countryData).map(([id, counts]) => ({
      id,
      displayName: counts.displayName,
      positive: counts.positive || 0,
      neutral: counts.neutral || 0,
      negative: counts.negative || 0,
      total:
        (counts.positive || 0) + (counts.neutral || 0) + (counts.negative || 0),
    }));
    console.log('Aggregated data (first 5):', aggregated.slice(0, 5));
    return aggregated;
  };

  // Setup amCharts5 map
  useEffect(() => {
    if (!data.length) return;
    console.log('Setting up amCharts5 map with', data.length, 'rows');
    try {
      const aggregated = aggregateData(data);
      const root = am5.Root.new('chartdiv');
      root.setThemes([am5themes_Animated.new(root)]);

      const chart = root.container.children.push(
        am5map.MapChart.new(root, {
          panX: 'translateX',
          panY: 'translateY',
          projection: am5map.geoMercator(),
          wheelY: 'zoom',
          maxZoomLevel: 32,
          zoomStep: 1.5,
        })
      );

      const polygonSeries = chart.series.push(
        am5map.MapPolygonSeries.new(root, {
          geoJSON: am5geodata_worldLow,
          exclude: ['AQ'],
          fill: am5.color(0xd3d3d3),
        })
      );

      // Default settings for all polygons
      polygonSeries.mapPolygons.template.setAll({
        interactive: true,
        fill: am5.color(0xd3d3d3),
        stroke: am5.color(0x000000),
        strokeWidth: 0.5,
        tooltipText: 'No data for {name}',
      });
      polygonSeries.mapPolygons.template.adapters.add(
        'fill',
        (fill, target) => {
          const dataItem = target.dataItem?.dataContext;
          return dataItem?.fill || am5.color(0xd3d3d3);
        }
      );
      polygonSeries.mapPolygons.template.adapters.add(
        'tooltipText',
        (text, target) => {
          const dataItem = target.dataItem?.dataContext;
          if (dataItem?.total > 0) {
            return `[bold]${
              dataItem.displayName || dataItem.id
            }[/]\nPositive: ${dataItem.positive}\nNeutral: ${
              dataItem.neutral
            }\nNegative: ${dataItem.negative}`;
          }
          return `No data for ${
            dataItem?.displayName || dataItem?.id || 'Unknown'
          }`;
        }
      );
      const getColor = (countryData, view) => {
        if (!countryData) return am5.color(0xd3d3d3);
        if (view === 'positive')
          return countryData.positive > 0
            ? am5.color(0x00ff00)
            : am5.color(0xd3d3d3);
        if (view === 'neutral')
          return countryData.neutral > 0
            ? am5.color(0xffff00)
            : am5.color(0xd3d3d3);
        if (view === 'negative')
          return countryData.negative > 0
            ? am5.color(0xff0000)
            : am5.color(0xd3d3d3);
        const total = countryData.total || 1;
        const score =
          (2 * (countryData.positive || 0) + (countryData.neutral || 0)) /
          total;
        if (score >= 1.5) return am5.color(0x00ff00); // Green
        if (score >= 0.5) return am5.color(0xffff00); // Yellow
        return am5.color(0xff0000); // Red
      };

      // Create data for all countries in GeoJSON
      const geoCountries = am5geodata_worldLow.features.map(
        (f) => f.properties.id
      );
      // Replace your getColor function with this
      // Helper function to interpolate between two colors
      const interpolateColor = (color1, color2, factor) => {
        if (factor <= 0) return color1;
        if (factor >= 1) return color2;

        const r1 = parseInt(color1.substring(1, 3), 16);
        const g1 = parseInt(color1.substring(3, 5), 16);
        const b1 = parseInt(color1.substring(5, 7), 16);

        const r2 = parseInt(color2.substring(1, 3), 16);
        const g2 = parseInt(color2.substring(3, 5), 16);
        const b2 = parseInt(color2.substring(5, 7), 16);

        const r = Math.round(r1 + (r2 - r1) * factor);
        const g = Math.round(g1 + (g2 - g1) * factor);
        const b = Math.round(b1 + (b2 - b1) * factor);

        return `#${((1 << 24) + (r << 16) + (g << 8) + b)
          .toString(16)
          .slice(1)}`;
      };

      // Replace getGradientColor with this
      const getGradientColor = (value, view) => {
        // value is between 0 and 1

        if (view === 'positive') {
          return interpolateColor('#cce5cc', '#006400', value); // Light green → Dark green
        }
        if (view === 'neutral') {
          return interpolateColor('#ffffcc', '#cccc00', value); // Light yellow → Olive
        }
        if (view === 'negative') {
          return interpolateColor('#f5cccc', '#8b0000', value); // Light red → Dark red
        }

        // Overall sentiment gradient (red → yellow → green)
        if (value >= 0.66) {
          return interpolateColor('#cccc00', '#006400', (value - 0.66) / 0.34); // Yellow → Green
        } else if (value >= 0.33) {
          return '#cccc00'; // Middle = yellow
        } else {
          return interpolateColor('#8b0000', '#cccc00', value / 0.33); // Red → Yellow
        }
      };

      // Replace getColorValue with:
      const getColorValue = (countryData, view) => {
        if (!countryData || countryData.total === 0) return 0;
        if (view === 'positive')
          return countryData.positive / countryData.total;
        if (view === 'neutral') return countryData.neutral / countryData.total;
        if (view === 'negative')
          return countryData.negative / countryData.total;

        // For overall sentiment
        const score =
          (2 * countryData.positive +
            countryData.neutral -
            2 * countryData.negative) /
          (2 * countryData.total);
        return (score + 1) / 2; // normalize -1 to 1 → 0 to 1
      };

      const seriesData = geoCountries.map((id) => {
        const countryData = aggregated.find((item) => item.id === id);
        if (countryData) {
          const sentimentScore = getColorValue(countryData, view);
          return {
            id,
            displayName: countryData.displayName,
            positive: countryData.positive,
            neutral: countryData.neutral,
            negative: countryData.negative,
            total: countryData.total,
            value: sentimentScore,
            fill: getGradientColor(sentimentScore, view),
            interactive: true,
          };
        }
        return {
          id,
          displayName: idToCountryName[id] || id,
          positive: 0,
          neutral: 0,
          negative: 0,
          total: 0,
          value: 0,
          fill: am5.color(0xd3d3d3),
          interactive: false,
        };
      });
      polygonSeries.data.setAll(seriesData);

      // Override settings for countries with data
      polygonSeries.mapPolygons.template.states.create('active', {
        interactive: true,
      });

      polygonSeries.mapPolygons.template.events.on('pointerover', (e) => {
        const country = e.target.dataItem.dataContext;
        if (country && country.interactive) {
          const displayName =
            idToCountryName[country.id] || country.displayName || country.id;
          e.target.set(
            'tooltipText',
            `${displayName}\nPositive: ${country.positive || 0}\nNeutral: ${
              country.neutral || 0
            }\nNegative: ${country.negative || 0}`
          );
        } else {
          const displayName =
            idToCountryName[country.id] || country.displayName || country.id;
          e.target.set('tooltipText', `No data for ${displayName}`);
        }
      });

      polygonSeries.mapPolygons.template.events.on('click', (e) => {
        const country = e.target.dataItem.dataContext;
        if (country && country.interactive) {
          setSelectedDetails(country);
          setSelectedCountry(country.id);
          const dataItem = e.target.dataItem;
          if (dataItem && dataItem.geometry) {
            chart.zoomToGeoBounds(dataItem.geometry, true);
          }
        }
      });

      return () => root.dispose();
    } catch (err) {
      console.error('Map setup error:', err);
      setError('Failed to initialize map: ' + err.message);
    }
  }, [data, view]);

  // Handler for closing the country details
  const handleCloseDetails = () => {
    setSelectedDetails(null);
    setSelectedCountry(''); // Reset dropdown
  };

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="bg-red-100 border border-red-400 text-red-700 px-6 py-4 rounded-lg shadow-md">
          <p className="font-bold">Error:</p>
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!data.length) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="text-gray-600 text-lg">Loading data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100 p-4 sm:p-6 lg:p-8">
      <h1 className="text-3xl font-extrabold mb-6 text-center text-gray-800">
        Global Sentiment Dashboard
      </h1>
      <div className="flex flex-col lg:flex-row gap-6">
        <div className="flex-1 bg-white p-6 rounded-lg shadow-xl">
          <div className="mb-6 flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className="flex items-center gap-2">
              <label
                htmlFor="view-select"
                className="text-gray-700 font-medium"
              >
                View:
              </label>
              <select
                id="view-select"
                className="border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-200 ease-in-out"
                value={view}
                onChange={(e) => setView(e.target.value)}
              >
                <option value="overall">Overall Sentiment</option>
                <option value="positive">Positive</option>
                <option value="neutral">Neutral</option>
                <option value="negative">Negative</option>
              </select>
            </div>
            <div className="flex items-center gap-2 ml-0 sm:ml-4">
              <label
                htmlFor="country-select"
                className="text-gray-700 font-medium"
              >
                Country:
              </label>
              <select
                id="country-select"
                className="border border-gray-300 rounded-md p-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition duration-200 ease-in-out"
                value={selectedCountry}
                onChange={(e) => {
                  const country = aggregateData(data).find(
                    (c) => c.id === e.target.value
                  );
                  setSelectedDetails(country);
                  setSelectedCountry(e.target.value);
                }}
              >
                <option value="">Select a country</option>
                {[...new Set(data.map((d) => d.country))]
                  .sort()
                  .map((country) => (
                    <option
                      key={country}
                      value={countryNameToId[country] || country.toUpperCase()}
                    >
                      {country}
                    </option>
                  ))}
              </select>
            </div>
          </div>
          <div
            id="chartdiv"
            className="w-full h-[500px] bg-gray-50 border border-gray-200 rounded-lg shadow-inner overflow-hidden"
          ></div>
          <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-3">
            <div className="flex items-center">
              <div className="w-5 h-5 bg-green-500 rounded-full mr-2 shadow-sm"></div>
              <span className="text-gray-700">Positive</span>
            </div>
            <div className="flex items-center">
              <div className="w-5 h-5 bg-yellow-500 rounded-full mr-2 shadow-sm"></div>
              <span className="text-gray-700">Neutral</span>
            </div>
            <div className="flex items-center">
              <div className="w-5 h-5 bg-red-500 rounded-full mr-2 shadow-sm"></div>
              <span className="text-gray-700">Negative</span>
            </div>
          </div>
        </div>
        {selectedDetails && (
          <div className="w-full lg:w-1/3 bg-gradient-to-br from-blue-50 to-blue-100 p-6 rounded-xl shadow-2xl border border-blue-200 relative transform transition-all duration-300 ease-out scale-100 hover:scale-105">
            <button
              onClick={handleCloseDetails}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-800 text-3xl font-bold p-1 rounded-full hover:bg-blue-200 transition-colors duration-200 leading-none"
              aria-label="Close"
            >
              &times;
            </button>
            <h2 className="text-3xl font-extrabold mb-5 text-gray-900 border-b-2 border-blue-300 pb-3">
              {idToCountryName[selectedDetails.id] ||
                selectedDetails.displayName ||
                selectedDetails.id}{' '}
              Overview
            </h2>
            <div className="space-y-4 text-lg text-gray-800">
              <p className="flex justify-between items-center bg-green-50 p-3 rounded-lg shadow-sm border border-green-200">
                <strong className="font-semibold text-green-700">
                  Positive:
                </strong>{' '}
                <span className="font-bold text-green-800">
                  {selectedDetails.positive || 0}
                </span>
              </p>
              <p className="flex justify-between items-center bg-yellow-50 p-3 rounded-lg shadow-sm border border-yellow-200">
                <strong className="font-semibold text-yellow-700">
                  Neutral:
                </strong>{' '}
                <span className="font-bold text-yellow-800">
                  {selectedDetails.neutral || 0}
                </span>
              </p>
              <p className="flex justify-between items-center bg-red-50 p-3 rounded-lg shadow-sm border border-red-200">
                <strong className="font-semibold text-red-700">
                  Negative:
                </strong>{' '}
                <span className="font-bold text-red-800">
                  {selectedDetails.negative || 0}
                </span>
              </p>
              <p className="flex justify-between items-center bg-blue-50 p-3 rounded-lg shadow-sm border border-blue-200 mt-6 pt-4 border-t-2 border-blue-300">
                <strong className="font-bold text-blue-700">
                  Total Entries:
                </strong>{' '}
                <span className="font-extrabold text-blue-800 text-xl">
                  {selectedDetails.total || 0}
                </span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
