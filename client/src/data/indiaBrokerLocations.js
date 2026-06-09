/**
 * Predefined State → City → Area (pincode) hierarchy for broker registration.
 * Areas sorted A–Z in UI; cities sorted A–Z per state.
 */
export const INDIA_BROKER_LOCATIONS = [
  {
    state: 'Delhi',
    stateCode: 'DL',
    cities: [
      {
        city: 'New Delhi',
        cityCode: 'NDL',
        areas: [
          { area: 'Connaught Place', pincode: '110001' },
          { area: 'Karol Bagh', pincode: '110005' },
          { area: 'Lajpat Nagar', pincode: '110024' },
          { area: 'Rohini', pincode: '110085' },
          { area: 'Saket', pincode: '110017' },
        ],
      },
      {
        city: 'South Delhi',
        cityCode: 'SDL',
        areas: [
          { area: 'Defence Colony', pincode: '110024' },
          { area: 'Greater Kailash', pincode: '110048' },
          { area: 'Hauz Khas', pincode: '110016' },
          { area: 'Vasant Kunj', pincode: '110070' },
        ],
      },
    ],
  },
  {
    state: 'Gujarat',
    stateCode: 'GJ',
    cities: [
      {
        city: 'Ahmedabad',
        cityCode: 'AMD',
        areas: [
          { area: 'Bodakdev', pincode: '380054' },
          { area: 'Maninagar', pincode: '380008' },
          { area: 'Navrangpura', pincode: '380009' },
          { area: 'Satellite', pincode: '380015' },
        ],
      },
      {
        city: 'Surat',
        cityCode: 'SRT',
        areas: [
          { area: 'Adajan', pincode: '395009' },
          { area: 'Athwa', pincode: '395001' },
          { area: 'Vesu', pincode: '395007' },
        ],
      },
    ],
  },
  {
    state: 'Karnataka',
    stateCode: 'KA',
    cities: [
      {
        city: 'Bengaluru',
        cityCode: 'BLR',
        areas: [
          { area: 'Electronic City', pincode: '560100' },
          { area: 'Indiranagar', pincode: '560038' },
          { area: 'Jayanagar', pincode: '560041' },
          { area: 'Koramangala', pincode: '560034' },
          { area: 'Whitefield', pincode: '560066' },
        ],
      },
      {
        city: 'Mysuru',
        cityCode: 'MYS',
        areas: [
          { area: 'Gokulam', pincode: '570002' },
          { area: 'Vijayanagar', pincode: '570017' },
        ],
      },
      {
        city: 'Mangaluru',
        cityCode: 'MNG',
        areas: [
          { area: 'Kadri', pincode: '575003' },
          { area: 'Lalbagh', pincode: '575002' },
        ],
      },
    ],
  },
  {
    state: 'Maharashtra',
    stateCode: 'MH',
    cities: [
      {
        city: 'Mumbai',
        cityCode: 'MUM',
        areas: [
          { area: 'Andheri East', pincode: '400069' },
          { area: 'Bandra West', pincode: '400050' },
          { area: 'Borivali West', pincode: '400092' },
          { area: 'Lower Parel', pincode: '400013' },
          { area: 'Powai', pincode: '400076' },
        ],
      },
      {
        city: 'Pune',
        cityCode: 'PUN',
        areas: [
          { area: 'Hinjewadi', pincode: '411057' },
          { area: 'Kothrud', pincode: '411038' },
          { area: 'Viman Nagar', pincode: '411014' },
          { area: 'Wakad', pincode: '411057' },
        ],
      },
      {
        city: 'Nagpur',
        cityCode: 'NAG',
        areas: [
          { area: 'Civil Lines', pincode: '440001' },
          { area: 'Dharampeth', pincode: '440010' },
        ],
      },
    ],
  },
  {
    state: 'Punjab',
    stateCode: 'PB',
    cities: [
      {
        city: 'Amritsar',
        cityCode: 'ATQ',
        areas: [
          { area: 'Hall Bazaar', pincode: '143001' },
          { area: 'Ranjit Avenue', pincode: '143001' },
        ],
      },
      {
        city: 'Ludhiana',
        cityCode: 'LDH',
        areas: [
          { area: 'Model Town', pincode: '141002' },
          { area: 'Sarabha Nagar', pincode: '141001' },
        ],
      },
    ],
  },
  {
    state: 'Rajasthan',
    stateCode: 'RJ',
    cities: [
      {
        city: 'Jaipur',
        cityCode: 'JAI',
        areas: [
          { area: 'C-Scheme', pincode: '302001' },
          { area: 'Malviya Nagar', pincode: '302017' },
          { area: 'Vaishali Nagar', pincode: '302021' },
        ],
      },
      {
        city: 'Udaipur',
        cityCode: 'UDR',
        areas: [
          { area: 'Fatehpura', pincode: '313004' },
          { area: 'Hiran Magri', pincode: '313002' },
        ],
      },
    ],
  },
  {
    state: 'Tamil Nadu',
    stateCode: 'TN',
    cities: [
      {
        city: 'Chennai',
        cityCode: 'CHE',
        areas: [
          { area: 'Adyar', pincode: '600020' },
          { area: 'Anna Nagar', pincode: '600040' },
          { area: 'T Nagar', pincode: '600017' },
          { area: 'Velachery', pincode: '600042' },
        ],
      },
      {
        city: 'Coimbatore',
        cityCode: 'CBE',
        areas: [
          { area: 'Gandhipuram', pincode: '641012' },
          { area: 'RS Puram', pincode: '641002' },
        ],
      },
    ],
  },
  {
    state: 'Telangana',
    stateCode: 'TS',
    cities: [
      {
        city: 'Hyderabad',
        cityCode: 'HYD',
        areas: [
          { area: 'Banjara Hills', pincode: '500034' },
          { area: 'Gachibowli', pincode: '500032' },
          { area: 'Hitech City', pincode: '500081' },
          { area: 'Secunderabad', pincode: '500003' },
        ],
      },
      {
        city: 'Warangal',
        cityCode: 'WGL',
        areas: [
          { area: 'Hanamkonda', pincode: '506001' },
          { area: 'Kazipet', pincode: '506003' },
        ],
      },
    ],
  },
  {
    state: 'Uttar Pradesh',
    stateCode: 'UP',
    cities: [
      {
        city: 'Lucknow',
        cityCode: 'LKO',
        areas: [
          { area: 'Aliganj', pincode: '226024' },
          { area: 'Gomti Nagar', pincode: '226010' },
          { area: 'Hazratganj', pincode: '226001' },
        ],
      },
      {
        city: 'Noida',
        cityCode: 'NOI',
        areas: [
          { area: 'Sector 18', pincode: '201301' },
          { area: 'Sector 62', pincode: '201309' },
          { area: 'Sector 76', pincode: '201301' },
        ],
      },
      {
        city: 'Varanasi',
        cityCode: 'VNS',
        areas: [
          { area: 'Cantt', pincode: '221002' },
          { area: 'Lanka', pincode: '221005' },
        ],
      },
    ],
  },
  {
    state: 'West Bengal',
    stateCode: 'WB',
    cities: [
      {
        city: 'Kolkata',
        cityCode: 'KOL',
        areas: [
          { area: 'Ballygunge', pincode: '700019' },
          { area: 'Park Street', pincode: '700016' },
          { area: 'Salt Lake', pincode: '700064' },
          { area: 'New Town', pincode: '700156' },
        ],
      },
      {
        city: 'Siliguri',
        cityCode: 'SIL',
        areas: [
          { area: 'Hill Cart Road', pincode: '734001' },
          { area: 'Sevoke Road', pincode: '734001' },
        ],
      },
    ],
  },
];
