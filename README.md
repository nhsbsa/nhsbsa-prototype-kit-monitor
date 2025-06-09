# NHSBSA Prototype Checker

A repository to automatically check all NHSBSA prototypes against the latest version of the [NHS Prototype Kit](https://prototype-kit.service.nhs.uk/) and [GOV.UK Prototype Kit]([https://prototype-kit.service.nhs.uk/](https://prototype-kit.service.gov.uk/docs/)). This ensures NHSBSA prototypes are always up-to-date and compatible with the latest NHS / GOV.UK design standards.

---

## Table of Contents

- [About](#about)  
- [Features](#features)  
- [Installation](#installation)  

---

## About

The NHSBSA Prototype Checker repository provides tools and scripts to validate and test all NHSBSA prototypes, verifying their compatibility with the latest NHS / GOV Prototype Kit version. This helps maintain consistency, usability, and accessibility across our digital services.

---

## Features

- Automatically fetches the latest NHS / GOV.UK Prototype Kit versions
- Checks all NHSBSA prototypes for compatibility issues
- GitHub action runs each day at midnight and provides reports on errors and warnings at https://nhsbsa.github.io/nhsbsa-prototype-kit-monitor/

---

## Installation

1. Clone the repository:

   ```bash
   git clone https://github.com/nhsbsa/nhsbsa-prototype-kit-monitor.git
   cd nhsbsa-prototype-kit-monitor
